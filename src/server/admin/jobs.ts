import { z } from "zod";

import type { AdminErrorSummary, AdminJobDetail, AdminJobRow, Page } from "@/lib/admin-types";
import { PRESET_SLUGS, PRESETS, type PresetSlug } from "@/lib/presets";
import { entitlementsLookup } from "@/server/billing/entitlements";
import { BillingRepository, iso } from "@/server/billing/repository";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { loadPresetSettings } from "@/server/presets/settings";

import { writeAudit } from "./audit";
import type { AdminDeps } from "./deps-types";
import { assertWrite, type AdminContext } from "./guard";
import { isUuid, likeEscape, pageOf, Where, type PageInput } from "./pagination";
import { reasonSchema } from "./users";

/**
 * Failure codes worth retrying: platform-side or transient problems. Not
 * retryable: content_blocked / invalid_input (the provider refused this
 * photo or request), source_unavailable (the photo is gone), fatal.
 */
export const RETRYABLE_ERROR_CODES = new Set([
  "retryable",
  "timeout",
  "rate_limited",
  "not_started",
  "internal_error",
  "provider_not_configured",
  "quota_exceeded",
  "auth",
  "invalid_output",
]);
export const RETRY_WINDOW_DAYS = 14;

const JOB_COLS = `j.id, j.created_at as "createdAt", j.finished_at as "finishedAt", j.shop_id as "shopId", s.name as "shopName",
  u.email as "requesterEmail", j.preset_slug as "presetSlug", j.status::text as status, j.error_code as "errorCode",
  j.credit_cost as "creditCost", j.refunded, j.cost_usd_micros::float8 as "costUsdMicros", j.provider, j.model,
  (select count(*)::int from public.job_attempts ja where ja.job_id = j.id) as attempts,
  (extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at))) * 1000)::int as "durationMs"`;
const JOB_FROM = `from public.generation_jobs j join public.shops s on s.id = j.shop_id left join auth.users u on u.id = j.requested_by`;

const normJob = <T extends AdminJobRow>(r: T): T => ({
  ...r,
  createdAt: iso(r.createdAt)!,
  finishedAt: iso(r.finishedAt),
  costUsdMicros: r.costUsdMicros === null ? null : Number(r.costUsdMicros),
});

export const jobFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["queued", "processing", "succeeded", "failed"]).optional().nullable(),
  preset: z.enum(PRESET_SLUGS).optional().nullable(),
  errorCode: z.string().trim().max(60).optional().nullable(),
  retryable: z.preprocess((v) => v === true || v === "1" || v === "true", z.boolean()).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type JobFilter = z.infer<typeof jobFilterSchema> & PageInput & { shopId?: string };

export async function listJobs(deps: AdminDeps, _ctx: AdminContext, f: JobFilter): Promise<Page<AdminJobRow>> {
  const w = new Where();
  if (f.shopId) w.add("j.shop_id = ?::uuid", f.shopId);
  const q = f.q?.trim();
  if (q) {
    if (isUuid(q)) w.add("(j.id = ?::uuid or j.shop_id = ?::uuid or j.requested_by = ?::uuid)", q, q, q);
    else w.add("(u.email ilike ? or s.name ilike ?)", likeEscape(q), likeEscape(q));
  }
  if (f.status) w.add("j.status = ?::public.job_status", f.status);
  if (f.preset) w.add("j.preset_slug = ?", f.preset);
  if (f.errorCode) w.add("j.error_code = ?", f.errorCode);
  if (f.retryable) {
    w.add(`j.status = 'failed' and j.error_code = any(string_to_array(?, ','))`, [...RETRYABLE_ERROR_CODES].join(","));
    w.add(`j.finished_at > now() - make_interval(days => ?)`, RETRY_WINDOW_DAYS);
  }
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminJobRow>(`select ${JOB_COLS} ${JOB_FROM} ${w.sql} order by j.created_at desc, j.id limit ${limit} offset ${offset}`, w.params),
    deps.db.query<{ n: number }>(`select count(*)::int as n ${JOB_FROM} ${w.sql}`, w.params),
  ]);
  return { items: rows.map(normJob), page, pageSize, total: count[0]?.n ?? 0 };
}

/* ---------------------------------------------------------------- detail */

type JobRecord = AdminJobRow & {
  errorMessage: string | null;
  presetVersion: number;
  instructionsLength: number;
  providerRequestId: string | null;
  startedAt: unknown;
  requestedBy: string;
  sourceImageId: string;
  sourceReady: boolean;
  requesterDisabled: boolean;
  requesterCanEdit: boolean;
};

async function loadJob(deps: AdminDeps, jobId: string): Promise<JobRecord | null> {
  if (!isUuid(jobId)) return null;
  const rows = await deps.db.query<JobRecord>(
    `select ${JOB_COLS}, j.error_message as "errorMessage", j.preset_version as "presetVersion",
            coalesce(char_length(j.instructions), 0) as "instructionsLength", j.provider_request_id as "providerRequestId",
            j.started_at as "startedAt", j.requested_by as "requestedBy", j.source_image_id as "sourceImageId",
            exists (select 1 from public.source_images si where si.id = j.source_image_id and si.status = 'ready') as "sourceReady",
            exists (select 1 from public.profiles p where p.id = j.requested_by and p.disabled_at is not null) as "requesterDisabled",
            exists (select 1 from public.shop_members m where m.shop_id = j.shop_id and m.user_id = j.requested_by and m.role in ('owner', 'editor')) as "requesterCanEdit"
       ${JOB_FROM} where j.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

const retryKey = (jobId: string) => `admin-retry:${jobId}`;

async function retryEligibility(deps: AdminDeps, job: JobRecord, now: Date): Promise<AdminJobDetail["retry"]> {
  const retried = await deps.db.query<{ id: string }>(`select id from public.generation_jobs where idempotency_key = $1`, [retryKey(job.id)]);
  const retriedAs = retried[0]?.id ?? null;
  const no = (reason: string) => ({ eligible: false, reason, retriedAs });
  if (retriedAs) return no("Already retried once from the admin dashboard.");
  if (job.status !== "failed") return no("Only failed jobs can be retried.");
  if (!job.errorCode || !RETRYABLE_ERROR_CODES.has(job.errorCode)) return no(`“${job.errorCode ?? "unknown"}” failures aren't retryable (the request itself was refused or invalid).`);
  if (!job.refunded && job.creditCost > 0) return no("The original credits weren't refunded; resolve that first.");
  if (job.finishedAt && now.getTime() - new Date(job.finishedAt).getTime() > RETRY_WINDOW_DAYS * 86_400_000) return no(`Older than ${RETRY_WINDOW_DAYS} days.`);
  if (!job.sourceReady) return no("The original photo is no longer available.");
  if (job.requesterDisabled) return no("The requester's account is disabled.");
  if (!job.requesterCanEdit) return no("The requester no longer has edit access to this shop.");
  if (!deps.providerConfigured || !deps.provider) return no("The image provider isn't configured.");
  return { eligible: true, reason: "Will create a new job for the same photo and style, charged to the shop like a normal generation.", retriedAs: null };
}

export async function getJobDetail(deps: AdminDeps, _ctx: AdminContext, jobId: string): Promise<AdminJobDetail> {
  const job = await loadJob(deps, jobId);
  if (!job) throw domainErrors.notFound("Job");
  const attempts = await deps.db.query<AdminJobDetail["attemptList"][number]>(
    `select attempt_no as "attemptNo", outcome, error_code as "errorCode", latency_ms as "latencyMs", cost_usd_micros::float8 as "costUsdMicros",
            provider_request_id as "providerRequestId", created_at as "createdAt"
       from public.job_attempts where job_id = $1 order by attempt_no`,
    [jobId],
  );
  const now = (deps.now ?? (() => new Date()))();
  const n = normJob(job);
  return {
    id: n.id, createdAt: n.createdAt, finishedAt: n.finishedAt, shopId: n.shopId, shopName: n.shopName, requesterEmail: n.requesterEmail,
    presetSlug: n.presetSlug, status: n.status, errorCode: n.errorCode, creditCost: n.creditCost, refunded: n.refunded,
    costUsdMicros: n.costUsdMicros, provider: n.provider, model: n.model, attempts: n.attempts, durationMs: n.durationMs,
    errorMessage: job.errorMessage,
    presetVersion: job.presetVersion,
    // Customer notes are private content: show only whether there were any.
    hasInstructions: job.instructionsLength > 0,
    instructionsLength: job.instructionsLength,
    providerRequestId: job.providerRequestId,
    startedAt: iso(job.startedAt),
    attemptList: attempts.map((a) => ({ ...a, createdAt: iso(a.createdAt)!, costUsdMicros: a.costUsdMicros === null ? null : Number(a.costUsdMicros) })),
    retry: await retryEligibility(deps, job, now),
  };
}

/* ----------------------------------------------------------------- retry */

export async function retryJob(deps: AdminDeps, ctx: AdminContext, input: { jobId: string; reason: string }) {
  assertWrite(ctx);
  const reason = reasonSchema.parse(input.reason);
  const job = await loadJob(deps, input.jobId);
  if (!job) throw domainErrors.notFound("Job");
  const now = (deps.now ?? (() => new Date()))();
  const eligibility = await retryEligibility(deps, job, now);
  if (!eligibility.eligible) throw new DomainError("invalid_request", eligibility.reason, 400);

  const slug = job.presetSlug as PresetSlug;
  const settings = (await loadPresetSettings(deps.db))[slug];
  if (!settings.enabled) throw new DomainError("invalid_request", "This style is switched off.", 400);
  const limits = await entitlementsLookup(new BillingRepository(deps.db))(job.shopId);

  const newJobId = await deps.db.transaction(async (tx) => {
    const original = await tx.query<{ instructions: string | null }>(`select instructions from public.generation_jobs where id = $1`, [job.id]);
    let rows: { r_job_id: string; r_replayed: boolean }[];
    try {
      rows = await tx.query<{ r_job_id: string; r_replayed: boolean }>(
        `select r_job_id, r_replayed from public.create_generation_job($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [job.requestedBy, job.shopId, job.sourceImageId, slug, PRESETS[slug].version, original[0]?.instructions ?? null, settings.creditCost,
          deps.provider!.id, deps.provider!.model, retryKey(job.id), limits.maxActiveJobs, limits.dailyGenerations],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("insufficient_credits")) throw new DomainError("insufficient_credits", "The shop doesn't have enough credits for a retry. Grant credits first if appropriate.", 402);
      if (msg.includes("too_many_active_jobs") || msg.includes("daily_limit_reached")) {
        throw new DomainError("rate_limited", "The shop is at its plan's generation limit. Try again later.", 429);
      }
      throw err;
    }
    const created = rows[0]!;
    if (created.r_replayed) throw new DomainError("conflict", "This job was already retried.", 409);
    await writeAudit(tx, ctx, {
      action: "job.retry",
      targetType: "job",
      targetId: job.id,
      reason,
      details: { newJobId: created.r_job_id, shopId: job.shopId, errorCode: job.errorCode, creditCost: settings.creditCost },
    });
    return created.r_job_id;
  });

  // Keep the original photo size and jewellery type. Best effort and outside the
  // transaction: without migration 20261103000100 the retry still runs, with default framing.
  await deps.db
    .query(
      `update public.generation_jobs n set photo_size = o.photo_size, jewellery_type = o.jewellery_type
         from public.generation_jobs o where n.id = $1 and o.id = $2`,
      [newJobId, job.id],
    )
    .catch(() => undefined);
  // Awaited: on Workers it sends to the queue, which must finish before the response.
  await deps.startJob?.(newJobId);
  return { jobId: newJobId };
}

/* ---------------------------------------------------------------- errors */

export async function errorSummary(deps: AdminDeps, ctx: AdminContext): Promise<AdminErrorSummary> {
  const [byCode, stuck, queued, webhooks, rejected, retryable] = await Promise.all([
    deps.db.query<{ errorCode: string; count: number; lastAt: unknown }>(
      `select coalesce(error_code, 'unknown') as "errorCode", count(*)::int as count, max(finished_at) as "lastAt"
         from public.generation_jobs where status = 'failed' and finished_at > now() - interval '7 days'
        group by 1 order by 2 desc`,
    ),
    deps.db.query<{ n: number }>(`select count(*)::int as n from public.generation_jobs where status = 'processing' and locked_until < now()`),
    deps.db.query<{ n: number }>(`select count(*)::int as n from public.generation_jobs where status = 'queued' and created_at < now() - interval '10 minutes'`),
    deps.db.query<{ eventId: string; type: string; attempts: number; lastError: string | null; receivedAt: unknown; processed: boolean }>(
      `select event_id as "eventId", event_type as type, attempts, last_error as "lastError", received_at as "receivedAt", processed_at is not null as processed
         from public.billing_webhook_events
        where last_error is not null or (processed_at is null and received_at < now() - interval '10 minutes')
        order by received_at desc limit 20`,
    ),
    deps.db.query<{ reason: string; count: number }>(
      `select coalesce(rejection_reason, 'unknown') as reason, count(*)::int as count
         from public.source_images where status = 'rejected' and created_at > now() - interval '7 days' group by 1 order by 2 desc limit 10`,
    ),
    listJobs(deps, ctx, { retryable: true, status: "failed", pageSize: 10 }),
  ]);
  return {
    failedByCode: byCode.map((r) => ({ ...r, lastAt: iso(r.lastAt)!, retryable: RETRYABLE_ERROR_CODES.has(r.errorCode) })),
    stuckJobs: stuck[0]?.n ?? 0,
    queuedOver10m: queued[0]?.n ?? 0,
    webhookFailures: webhooks.map((r) => ({ ...r, receivedAt: iso(r.receivedAt)! })),
    rejectedUploads: rejected,
    retryableJobs: retryable.items,
  };
}

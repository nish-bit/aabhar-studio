import { z } from "zod";

import { PRESETS, type PresetSlug } from "@/lib/presets";
import type { AdminRefundRequestView, RefundableImage, RefundRequestView } from "@/lib/support-types";
import { writeAudit } from "@/server/admin/audit";
import { ensureUserShop, membershipOrOnboard } from "@/server/auth/ensure-shop";
import { assertWrite, type AdminContext } from "@/server/admin/guard";
import { BillingRepository, iso } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { BUCKETS, type ObjectStorage } from "@/server/generation/ports";

/**
 * Refund requests for generated photos that came out wrong. (Failed
 * generations are refunded automatically elsewhere; this is for results a
 * person needs to look at.) A customer picks photos from the last
 * REFUND_WINDOW_DAYS days and explains the problem; an admin compares each
 * original with its result and approves or rejects. Approval returns the
 * photos' credits as one keyed grant, so it can't be paid twice, and each
 * photo can only ever be in one request.
 */
export interface RefundDeps {
  db: Db;
  storage: ObjectStorage;
}

export const REFUND_WINDOW_DAYS = 30;
/** Credits returned by an approved request last as long as pack credits. */
const RETURNED_CREDIT_DAYS = 365;
const URL_TTL = 600;
const DAY_MS = 86_400_000;



const style = (slug: string) => PRESETS[slug as PresetSlug]?.name ?? slug;

async function shopOf(db: Db, userId: string, write: boolean): Promise<string> {
  const lookup = async () =>
    (
      await db.query<{ shopId: string; role: string }>(
        `select shop_id as "shopId", role::text as role from public.shop_members where user_id = $1 order by created_at limit 1`,
        [userId],
      )
    )[0] ?? null;
  const m = await membershipOrOnboard(lookup, () => ensureUserShop(db, userId));
  if (write && m.role === "viewer") throw domainErrors.forbidden();
  return m.shopId;
}

const signed = (storage: ObjectStorage | null, path: string | null, bucket: (typeof BUCKETS)[keyof typeof BUCKETS] = BUCKETS.generated) =>
  storage && path ? storage.signedUrl(bucket, path, URL_TTL).catch(() => null) : Promise.resolve(null);

/** Recent results of this shop that aren't already part of a request. */
export async function listRefundableImages(deps: RefundDeps, userId: string): Promise<RefundableImage[]> {
  const shopId = await shopOf(deps.db, userId, false);
  const rows = await deps.db.query<{ id: string; path: string; preset: string; cost: number; createdAt: Date | string }>(
    `select g.id, g.storage_path as path, j.preset_slug as preset, j.credit_cost as cost, g.created_at as "createdAt"
       from public.generated_images g join public.generation_jobs j on j.id = g.job_id
      where g.shop_id = $1 and j.status = 'succeeded' and g.created_at > now() - make_interval(days => $2)
        and not exists (select 1 from public.refund_request_items i where i.generated_image_id = g.id)
      order by g.created_at desc limit 60`,
    [shopId, REFUND_WINDOW_DAYS],
  );
  return Promise.all(
    rows.map(async (r) => ({
      generatedImageId: r.id,
      url: (await signed(deps.storage, r.path)) ?? "",
      styleName: style(r.preset),
      creditCost: r.cost,
      createdAt: iso(r.createdAt)!,
    })),
  );
}

export const createRefundRequestSchema = z
  .object({
    imageIds: z.array(z.uuid()).min(1, "Pick at least one photo.").max(20, "Pick up to 20 photos per request."),
    reason: z.string().trim().min(10, "Tell us what went wrong (at least 10 characters).").max(1000),
  })
  .strict();

export async function createRefundRequest(deps: RefundDeps, userId: string, raw: unknown): Promise<RefundRequestView[]> {
  const input = createRefundRequestSchema.parse(raw);
  const ids = [...new Set(input.imageIds)];
  const shopId = await shopOf(deps.db, userId, true);
  await deps.db.transaction(async (tx) => {
    const images = await tx.query<{ id: string; jobId: string; cost: number }>(
      `select g.id, g.job_id as "jobId", j.credit_cost as cost
         from public.generated_images g join public.generation_jobs j on j.id = g.job_id
        where g.id = any(string_to_array($1, ',')::uuid[]) and g.shop_id = $2 and j.status = 'succeeded'
          and g.created_at > now() - make_interval(days => $3)`,
      [ids.join(","), shopId, REFUND_WINDOW_DAYS],
    );
    if (images.length !== ids.length) {
      throw new DomainError("invalid_request", `Some of those photos can't be included. Pick photos from the last ${REFUND_WINDOW_DAYS} days.`, 400);
    }
    const total = images.reduce((sum, i) => sum + i.cost, 0);
    const req = await tx.query<{ id: string }>(
      `insert into public.refund_requests (shop_id, user_id, reason, credits_requested) values ($1, $2, $3, $4) returning id`,
      [shopId, userId, input.reason, total],
    );
    try {
      for (const i of images) {
        await tx.query(
          `insert into public.refund_request_items (request_id, generated_image_id, job_id, credit_cost) values ($1, $2, $3, $4)`,
          [req[0]!.id, i.id, i.jobId, i.cost],
        );
      }
    } catch (err) {
      if (/refund_request_items_generated_image_id_key|duplicate key/i.test(String(err))) {
        throw new DomainError("conflict", "One of those photos is already in a refund request.", 409);
      }
      throw err;
    }
  });
  return listMyRefundRequests(deps, userId);
}

async function requestsWhere(deps: { db: Db }, where: string, params: (string | null)[], limit: number) {
  const rows = await deps.db.query<{
    id: string; status: RefundRequestView["status"]; reason: string; creditsRequested: number; creditsReturned: number;
    adminNote: string | null; createdAt: Date | string; decidedAt: Date | string | null; email: string | null; shopId: string;
  }>(
    `select r.id, r.status, r.reason, r.credits_requested as "creditsRequested", r.credits_returned as "creditsReturned",
            r.admin_note as "adminNote", r.created_at as "createdAt", r.decided_at as "decidedAt", u.email, r.shop_id as "shopId"
       from public.refund_requests r left join auth.users u on u.id = r.user_id
      ${where} order by r.created_at desc limit ${limit}`,
    params,
  );
  const items = rows.length
    ? await deps.db.query<{ requestId: string; id: string; path: string; preset: string; sourcePath: string | null }>(
        `select i.request_id as "requestId", g.id, g.storage_path as path, j.preset_slug as preset, s.storage_path as "sourcePath"
           from public.refund_request_items i
           join public.generated_images g on g.id = i.generated_image_id
           join public.generation_jobs j on j.id = i.job_id
           left join public.source_images s on s.id = j.source_image_id
          where i.request_id = any(string_to_array($1, ',')::uuid[])`,
        [rows.map((r) => r.id).join(",")],
      )
    : [];
  return { rows, items };
}

export async function listMyRefundRequests(deps: RefundDeps, userId: string): Promise<RefundRequestView[]> {
  const shopId = await shopOf(deps.db, userId, false);
  const { rows, items } = await requestsWhere(deps, "where r.shop_id = $1", [shopId], 20);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      creditsRequested: r.creditsRequested,
      creditsReturned: r.creditsReturned,
      adminNote: r.adminNote,
      createdAt: iso(r.createdAt)!,
      decidedAt: iso(r.decidedAt),
      images: await Promise.all(
        items.filter((i) => i.requestId === r.id).map(async (i) => ({ generatedImageId: i.id, url: await signed(deps.storage, i.path), styleName: style(i.preset) })),
      ),
    })),
  );
}

/* ------------------------------------------------------------------ admin */


/** Without storage (not configured) the list still works; image links are just missing. */
export async function listRefundRequestsForAdmin(
  deps: { db: Db; storage: ObjectStorage | null },
  _ctx: AdminContext,
  status: "pending" | "approved" | "rejected" | null,
): Promise<AdminRefundRequestView[]> {
  const { rows, items } = await requestsWhere(deps, status ? "where r.status = $1" : "", status ? [status] : [], 50);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      creditsRequested: r.creditsRequested,
      creditsReturned: r.creditsReturned,
      adminNote: r.adminNote,
      createdAt: iso(r.createdAt)!,
      decidedAt: iso(r.decidedAt),
      email: r.email,
      shopId: r.shopId,
      images: await Promise.all(
        items
          .filter((i) => i.requestId === r.id)
          .map(async (i) => ({
            generatedImageId: i.id,
            url: await signed(deps.storage, i.path),
            originalUrl: await signed(deps.storage, i.sourcePath, BUCKETS.originals),
            styleName: style(i.preset),
          })),
      ),
    })),
  );
}

export const refundDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(1000).optional().default(""),
  })
  .strict();

/** Approve (returns the credits) or reject a pending request. Admin role only; audited. */
export async function decideRefundRequest(db: Db, ctx: AdminContext, id: string, raw: unknown) {
  assertWrite(ctx);
  const input = refundDecisionSchema.parse(raw);
  if (input.decision === "rejected" && input.note.length < 5) {
    throw new DomainError("invalid_request", "Say briefly why it's rejected; the customer sees this note.", 400);
  }
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ shopId: string; status: string; credits: number }>(
      `select shop_id as "shopId", status, credits_requested as credits from public.refund_requests where id = $1 for update`,
      [id],
    );
    const r = rows[0];
    if (!r) throw domainErrors.notFound("Refund request");
    if (r.status !== "pending") throw new DomainError("conflict", "This request has already been decided.", 409);

    let grantId: string | null = null;
    if (input.decision === "approved") {
      grantId = await new BillingRepository(tx).grantCredits({
        shopId: r.shopId, amount: r.credits, source: "refund_request",
        expiresAt: new Date(Date.now() + RETURNED_CREDIT_DAYS * DAY_MS),
        key: `refund-request:${id}`, reason: "Credits returned after your refund request",
      });
    }
    await tx.query(
      `update public.refund_requests set status = $2, admin_note = nullif($3, ''), decided_by = $4, decided_at = now(),
              credits_returned = $5, grant_id = $6 where id = $1`,
      [id, input.decision, input.note, ctx.userId, input.decision === "approved" ? r.credits : 0, grantId],
    );
    await writeAudit(tx, ctx, {
      action: input.decision === "approved" ? "refund_request.approve" : "refund_request.reject",
      targetType: "refund_request",
      targetId: id,
      reason: input.note || null,
      details: { shopId: r.shopId, credits: input.decision === "approved" ? r.credits : 0 },
    });
    return { id, status: input.decision, creditsReturned: input.decision === "approved" ? r.credits : 0 };
  });
}

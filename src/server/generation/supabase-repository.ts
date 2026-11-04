import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { JobStatus, ReviewStatus } from "@/lib/api-types";
import { isJewelleryType } from "@/lib/jewellery-types";
import { isPhotoSize } from "@/lib/photo-sizes";
import { isPresetSlug } from "@/lib/presets";

import { DomainError, domainErrors } from "./domain-error";
import type {
  AttemptRecord,
  CompleteJobParams,
  CreateJobParams,
  GeneratedImageRecord,
  GenerationRepository,
  JobOptions,
  JobRecord,
  Membership,
  SourceImageRecord,
} from "./ports";

/* Row shapes as returned by PostgREST (snake_case). */
interface JobRow {
  id: string;
  shop_id: string;
  source_image_id: string;
  requested_by: string;
  preset_slug: string;
  preset_version: number;
  instructions: string | null;
  credit_cost: number;
  status: JobStatus;
  provider: string;
  model: string;
  error_code: string | null;
  error_message: string | null;
  refunded: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface SourceRow {
  id: string;
  shop_id: string;
  uploaded_by: string;
  file_name: string;
  declared_mime_type: string;
  status: "pending" | "ready" | "rejected";
  upload_path: string;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

function toJob(r: JobRow): JobRecord {
  if (!isPresetSlug(r.preset_slug)) throw new Error(`Unknown preset ${r.preset_slug}`);
  return {
    id: r.id,
    shopId: r.shop_id,
    sourceImageId: r.source_image_id,
    requestedBy: r.requested_by,
    presetSlug: r.preset_slug,
    presetVersion: r.preset_version,
    instructions: r.instructions,
    creditCost: r.credit_cost,
    status: r.status,
    provider: r.provider,
    model: r.model,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    refunded: r.refunded,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function toSource(r: SourceRow): SourceImageRecord {
  return {
    id: r.id,
    shopId: r.shop_id,
    uploadedBy: r.uploaded_by,
    fileName: r.file_name,
    declaredMimeType: r.declared_mime_type,
    status: r.status,
    uploadPath: r.upload_path,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
  };
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const JOB_COLUMNS =
  "id, shop_id, source_image_id, requested_by, preset_slug, preset_version, instructions, credit_cost, status, provider, model, error_code, error_message, refunded, created_at, started_at, finished_at";
const SOURCE_COLUMNS =
  "id, shop_id, uploaded_by, file_name, declared_mime_type, status, upload_path, storage_path, mime_type, width, height, created_at";

/** GenerationRepository backed by Supabase (service role + SQL functions). */
export class SupabaseGenerationRepository implements GenerationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getMembership(userId: string): Promise<Membership | null> {
    const data = check(
      await this.db
        .from("shop_members")
        .select("shop_id, role")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      "getMembership",
    );
    return data ? { shopId: data.shop_id as string, role: data.role as Membership["role"] } : null;
  }

  async getBalance(shopId: string): Promise<number> {
    const data = check(
      await this.db.from("credit_balances").select("balance").eq("shop_id", shopId).maybeSingle(),
      "getBalance",
    );
    return (data?.balance as number | undefined) ?? 0;
  }

  async createSourceImage(p: Parameters<GenerationRepository["createSourceImage"]>[0]): Promise<void> {
    check(
      await this.db.from("source_images").insert({
        id: p.id,
        shop_id: p.shopId,
        uploaded_by: p.userId,
        file_name: p.fileName,
        declared_mime_type: p.declaredMimeType,
        declared_bytes: p.sizeBytes,
        upload_path: p.uploadPath,
      }),
      "createSourceImage",
    );
  }

  async getSourceImage(id: string): Promise<SourceImageRecord | null> {
    const data = check(
      await this.db.from("source_images").select(SOURCE_COLUMNS).eq("id", id).maybeSingle<SourceRow>(),
      "getSourceImage",
    );
    return data ? toSource(data) : null;
  }

  async markSourceReady(id: string, d: Parameters<GenerationRepository["markSourceReady"]>[1]): Promise<void> {
    check(
      await this.db
        .from("source_images")
        .update({
          status: "ready",
          storage_path: d.storagePath,
          mime_type: d.mimeType,
          width: d.width,
          height: d.height,
          bytes: d.bytes,
          sha256: d.sha256,
        })
        .eq("id", id)
        .eq("status", "pending"),
      "markSourceReady",
    );
  }

  async markSourceRejected(id: string, reason: string): Promise<void> {
    check(
      await this.db.from("source_images").update({ status: "rejected", rejection_reason: reason }).eq("id", id),
      "markSourceRejected",
    );
  }

  async countRecentUploads(shopId: string, sinceIso: string): Promise<number> {
    const res = await this.db
      .from("source_images")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gte("created_at", sinceIso);
    if (res.error) throw new Error(`countRecentUploads: ${res.error.message}`);
    return res.count ?? 0;
  }

  async createJobWithDebit(p: CreateJobParams) {
    const { data, error } = await this.db.rpc("create_generation_job", {
      p_user: p.userId,
      p_shop: p.shopId,
      p_source_image: p.sourceImageId,
      p_preset: p.presetSlug,
      p_preset_version: p.presetVersion,
      p_instructions: p.instructions,
      p_credit_cost: p.creditCost,
      p_provider: p.provider,
      p_model: p.model,
      p_idempotency_key: p.idempotencyKey,
      p_max_active: p.maxActiveJobs,
      p_daily_limit: p.dailyLimit,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.startsWith("insufficient_credits")) {
        const balance = Number(msg.split(":")[1] ?? 0);
        throw domainErrors.insufficientCredits(p.creditCost, Number.isFinite(balance) ? balance : 0);
      }
      if (msg.includes("too_many_active_jobs")) throw domainErrors.tooManyActive(p.maxActiveJobs);
      if (msg.includes("daily_limit_reached")) throw domainErrors.dailyLimit();
      if (msg.includes("source_not_found")) throw domainErrors.notFound("Photo");
      if (msg.includes("source_not_ready")) {
        throw new DomainError("invalid_request", "Upload and check the photo before generating.", 400);
      }
      if (msg.includes("account_disabled")) throw domainErrors.accountDisabled();
      if (msg.includes("forbidden")) throw domainErrors.forbidden();
      throw new Error(`create_generation_job: ${msg}`);
    }
    const row = (Array.isArray(data) ? data[0] : data) as { r_job_id: string; r_replayed: boolean; r_balance: number };
    return { jobId: row.r_job_id, replayed: row.r_replayed, balance: row.r_balance };
  }

  async claimJob(jobId: string, leaseSeconds: number): Promise<JobRecord | null> {
    const data = check(
      await this.db.rpc("claim_generation_job", { p_job: jobId, p_lease_seconds: leaseSeconds }),
      "claimJob",
    ) as JobRow[] | null;
    const row = data?.[0];
    return row ? toJob(row) : null;
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const data = check(
      await this.db.from("generation_jobs").select(JOB_COLUMNS).eq("id", jobId).maybeSingle<JobRow>(),
      "getJob",
    );
    return data ? toJob(data) : null;
  }

  async setJobOptions(jobId: string, o: JobOptions): Promise<void> {
    const { error } = await this.db
      .from("generation_jobs")
      .update({ photo_size: o.photoSize, jewellery_type: o.jewelleryType })
      .eq("id", jobId);
    if (error) throw new Error(`setJobOptions: ${error.message}`);
  }

  async getJobOptions(jobId: string): Promise<JobOptions> {
    const { data, error } = await this.db
      .from("generation_jobs")
      .select("photo_size, jewellery_type")
      .eq("id", jobId)
      .maybeSingle<{ photo_size: string | null; jewellery_type: string | null }>();
    // Missing columns (migration not applied) or any read error: original behaviour.
    if (error || !data) return { photoSize: null, jewelleryType: null };
    return {
      photoSize: isPhotoSize(data.photo_size) ? data.photo_size : null,
      jewelleryType: isJewelleryType(data.jewellery_type) ? data.jewellery_type : null,
    };
  }

  async recordAttempt(a: AttemptRecord): Promise<void> {
    check(
      await this.db.from("job_attempts").insert({
        job_id: a.jobId,
        attempt_no: a.attemptNo,
        provider: a.provider,
        model: a.model,
        outcome: a.outcome,
        error_code: a.errorCode,
        provider_request_id: a.providerRequestId,
        latency_ms: a.latencyMs,
        usage: a.usage,
        cost_usd_micros: a.costUsdMicros,
      }),
      "recordAttempt",
    );
  }

  async completeJob(p: CompleteJobParams): Promise<boolean> {
    return check(
      await this.db.rpc("complete_generation_job", {
        p_job: p.jobId,
        p_storage_path: p.storagePath,
        p_mime_type: p.mimeType,
        p_width: p.width,
        p_height: p.height,
        p_bytes: p.bytes,
        p_usage: p.usage,
        p_cost_usd_micros: p.costUsdMicros,
        p_provider_request_id: p.providerRequestId,
      }),
      "completeJob",
    ) as boolean;
  }

  async failJob(jobId: string, errorCode: string, errorMessage: string, refund: boolean): Promise<boolean> {
    return check(
      await this.db.rpc("fail_generation_job", {
        p_job: jobId,
        p_error_code: errorCode,
        p_error_message: errorMessage,
        p_refund: refund,
      }),
      "failJob",
    ) as boolean;
  }

  async expireStaleJobs(): Promise<number> {
    return check(await this.db.rpc("expire_stale_generation_jobs"), "expireStaleJobs") as number;
  }

  async getGeneratedImageForJob(jobId: string): Promise<GeneratedImageRecord | null> {
    const data = check(
      await this.db
        .from("generated_images")
        .select("id, job_id, shop_id, storage_path, width, height, review_status")
        .eq("job_id", jobId)
        .maybeSingle(),
      "getGeneratedImageForJob",
    );
    if (!data) return null;
    return {
      id: data.id as string,
      jobId: data.job_id as string,
      shopId: data.shop_id as string,
      storagePath: data.storage_path as string,
      width: data.width as number,
      height: data.height as number,
      reviewStatus: data.review_status as ReviewStatus,
    };
  }

  async setReviewStatus(generatedImageId: string, status: ReviewStatus): Promise<void> {
    check(
      await this.db
        .from("generated_images")
        .update({ review_status: status, reviewed_at: new Date().toISOString() })
        .eq("id", generatedImageId),
      "setReviewStatus",
    );
  }
}

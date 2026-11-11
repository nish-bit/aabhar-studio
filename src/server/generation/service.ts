import { createHash, randomUUID } from "node:crypto";


import { presetAllowed, type PlanLimits } from "@/config/billing";
import type { GenerationView, ReviewStatus } from "@/lib/api-types";
import type { PresetSettings } from "@/server/presets/settings";
import type { JewelleryTypeId } from "@/lib/jewellery-types";
import { cropBoxFor, photoSizeById, type PhotoSize, type PhotoSizeId } from "@/lib/photo-sizes";
import { PRESETS, type PresetSlug } from "@/lib/presets";
import { membershipOrOnboard } from "@/server/auth/ensure-shop";
import { ProviderError, userMessageFor } from "@/server/providers/image/errors";
import type { ImageEditProvider } from "@/server/providers/image/types";
import { readImageHeader } from "@/server/imaging/header";
import { imageProcessor } from "@/server/imaging/processor";
import { ImageValidationError, outputSizeFor, sanitizeImage, validateDeclaredUpload, validateImageBytes } from "@/server/imaging/validate";

import { DomainError, domainErrors } from "./domain-error";
import { BUCKETS, type GenerationRepository, type JobOptions, type JobRecord, type ObjectStorage } from "./ports";
import { buildEditPrompt, sanitizeInstructions } from "./prompts";

/**
 * Generation use-cases. Pure orchestration over the repository, storage and
 * provider ports — no Supabase, Next.js or vendor specifics in here.
 */

export interface GenerationDeps {
  repo: GenerationRepository;
  storage: ObjectStorage;
  provider: ImageEditProvider | null;
  /** Fallback limits when billing isn't connected. */
  limits: { maxActiveJobs: number; dailyLimit: number };
  /** Plan limits from billing (server-side records only). When present, they replace `limits`. */
  entitlements?: ((shopId: string) => Promise<PlanLimits>) | null;
  /** Admin preset settings (enabled, credit cost). When absent, code defaults apply. */
  presetSettings?: (() => Promise<PresetSettings>) | null;
  /** Sets up the user's own shop if it's missing (production: public.ensure_user_shop). */
  ensureShop?: ((userId: string) => Promise<boolean>) | null;
  /** Injected so tests don't wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export const JOB_LEASE_SECONDS = 295;
export const MAX_PROVIDER_ATTEMPTS = 2;
/** Sanity cap on provider images (the model returns at most 1536×1024). */
const PROVIDER_OUTPUT_MAX_PIXELS = 40_000_000;
const MAX_UPLOADS_PER_10_MIN = 60;
const SIGNED_URL_TTL_SECONDS = 600;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function requireMembership(deps: GenerationDeps, userId: string, write: boolean) {
  const m = await membershipOrOnboard(() => deps.repo.getMembership(userId), deps.ensureShop ? () => deps.ensureShop!(userId) : null);
  if (write && m.role === "viewer") throw domainErrors.forbidden();
  return m;
}

/* ------------------------------------------------------------------ uploads */

export async function signUpload(
  deps: GenerationDeps,
  userId: string,
  input: { fileName: string; mimeType: string; sizeBytes: number },
) {
  try {
    validateDeclaredUpload(input);
  } catch (err) {
    if (err instanceof ImageValidationError) throw new DomainError("invalid_file", err.message, 400);
    throw err;
  }
  const m = await requireMembership(deps, userId, true);

  const since = new Date((deps.now ?? Date.now)() - 10 * 60_000).toISOString();
  if ((await deps.repo.countRecentUploads(m.shopId, since)) >= MAX_UPLOADS_PER_10_MIN) {
    throw domainErrors.rateLimited();
  }

  const id = randomUUID();
  const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  const uploadPath = `${m.shopId}/${id}/upload.${ext}`;
  await deps.repo.createSourceImage({
    id,
    shopId: m.shopId,
    userId,
    fileName: input.fileName.slice(0, 255),
    declaredMimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadPath,
  });
  const signed = await deps.storage.createSignedUploadUrl(BUCKETS.originals, uploadPath);
  return { sourceImageId: id, bucket: BUCKETS.originals, path: signed.path, token: signed.token };
}

/** Validate the uploaded bytes, store a sanitised copy, and mark the source ready. */
export async function completeUpload(deps: GenerationDeps, userId: string, sourceImageId: string) {
  const m = await requireMembership(deps, userId, true);
  const source = await deps.repo.getSourceImage(sourceImageId);
  if (!source || source.shopId !== m.shopId) throw domainErrors.notFound("Photo");
  if (source.status === "ready") return sourceView(deps, source.id);
  if (source.status === "rejected") throw new DomainError("invalid_file", "This photo was rejected. Upload it again.", 400);

  let raw: Uint8Array;
  try {
    raw = await deps.storage.download(BUCKETS.originals, source.uploadPath);
  } catch {
    throw new DomainError("invalid_request", "We couldn't find the uploaded file. Please upload it again.", 400);
  }

  try {
    await validateImageBytes(raw, source.declaredMimeType);
    const clean = await sanitizeImage(raw);
    const ext = clean.mimeType === "image/png" ? "png" : "jpg";
    const storagePath = `${m.shopId}/${source.id}/source.${ext}`;
    await deps.storage.upload(BUCKETS.originals, storagePath, clean.bytes, clean.mimeType);
    await deps.repo.markSourceReady(source.id, {
      storagePath,
      mimeType: clean.mimeType,
      width: clean.width,
      height: clean.height,
      bytes: clean.bytes.byteLength,
      sha256: clean.sha256,
    });
  } catch (err) {
    if (err instanceof ImageValidationError) {
      await deps.repo.markSourceRejected(source.id, err.code);
      await deps.storage.remove(BUCKETS.originals, [source.uploadPath]).catch(() => undefined);
      throw new DomainError("invalid_file", err.message, 400);
    }
    throw err;
  } finally {
    // The raw upload (with original metadata) is never kept once processed.
    await deps.storage.remove(BUCKETS.originals, [source.uploadPath]).catch(() => undefined);
  }

  return sourceView(deps, source.id);
}

async function sourceView(deps: GenerationDeps, sourceImageId: string) {
  const s = await deps.repo.getSourceImage(sourceImageId);
  if (!s || s.status !== "ready" || !s.storagePath || !s.width || !s.height) throw domainErrors.notFound("Photo");
  return {
    id: s.id,
    fileName: s.fileName,
    width: s.width,
    height: s.height,
    url: await deps.storage.signedUrl(BUCKETS.originals, s.storagePath, SIGNED_URL_TTL_SECONDS),
  };
}

/* -------------------------------------------------------------- generation */

export async function submitGeneration(
  deps: GenerationDeps,
  userId: string,
  input: {
    sourceImageId: string;
    presetSlug: PresetSlug;
    instructions?: string | null;
    idempotencyKey: string;
    photoSize?: PhotoSizeId | null;
    jewelleryType?: JewelleryTypeId | null;
  },
) {
  if (!deps.provider) throw domainErrors.providerNotConfigured();
  const m = await requireMembership(deps, userId, true);
  const preset = PRESETS[input.presetSlug];

  let creditCost = preset.creditCost;
  if (deps.presetSettings) {
    const setting = (await deps.presetSettings())[preset.slug];
    if (!setting.enabled) throw new DomainError("invalid_request", `The ${preset.name} style isn't available right now. Choose another style.`, 400);
    creditCost = setting.creditCost;
  }

  let maxActiveJobs = deps.limits.maxActiveJobs;
  let dailyLimit = deps.limits.dailyLimit;
  if (deps.entitlements) {
    const plan = await deps.entitlements(m.shopId);
    if (!presetAllowed(plan.presets, preset.slug)) {
      throw new DomainError("plan_limit", `The ${preset.name} style unlocks when you buy any credit pack.`, 403);
    }
    maxActiveJobs = plan.maxActiveJobs;
    dailyLimit = plan.dailyGenerations;
  }

  const result = await deps.repo.createJobWithDebit({
    userId,
    shopId: m.shopId,
    sourceImageId: input.sourceImageId,
    presetSlug: preset.slug,
    presetVersion: preset.version,
    instructions: sanitizeInstructions(input.instructions),
    creditCost,
    provider: deps.provider.id,
    model: deps.provider.model,
    idempotencyKey: `${userId}:${input.idempotencyKey}`,
    maxActiveJobs,
    dailyLimit,
  });

  // Store the studio options before the job runs (the caller starts it after responding).
  // A replay keeps the options of the original request. If they can't be saved (e.g. the
  // migration isn't applied yet), the job still runs, with the original framing.
  const options: JobOptions = { photoSize: input.photoSize ?? null, jewelleryType: input.jewelleryType ?? null };
  if (!result.replayed && (options.photoSize || options.jewelleryType) && deps.repo.setJobOptions) {
    await deps.repo.setJobOptions(result.jobId, options).catch((err: unknown) => {
      (deps.log ?? (() => undefined))("generation.options_not_saved", { jobId: result.jobId, error: String(err).slice(0, 200) });
    });
  }

  return result;
}

/**
 * Runs one job to completion. Safe to call more than once: only the caller
 * that claims the queued job does any work, and every state change is
 * guarded so late or duplicate calls can't double-complete or double-refund.
 */
export async function runGenerationJob(deps: GenerationDeps, jobId: string): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? (() => undefined);

  const job = await deps.repo.claimJob(jobId, JOB_LEASE_SECONDS);
  if (!job) return; // already running, finished, or unknown

  const deadline = now() + (JOB_LEASE_SECONDS - 15) * 1000;
  const provider = deps.provider;
  if (!provider) {
    await deps.repo.failJob(job.id, "provider_not_configured", domainErrors.providerNotConfigured().message, true);
    return;
  }

  const options: JobOptions = deps.repo.getJobOptions
    ? await deps.repo.getJobOptions(job.id).catch(() => ({ photoSize: null, jewelleryType: null }))
    : { photoSize: null, jewelleryType: null };
  const photoSize = options.photoSize ? photoSizeById(options.photoSize) : null;

  let sourceBytes: Uint8Array;
  let size: "1024x1024" | "1536x1024" | "1024x1536";
  let mimeType: "image/jpeg" | "image/png";
  try {
    const source = await deps.repo.getSourceImage(job.sourceImageId);
    if (!source?.storagePath || !source.width || !source.height || source.status !== "ready") {
      throw new Error("source not ready");
    }
    sourceBytes = await deps.storage.download(BUCKETS.originals, source.storagePath);
    // A chosen photo size picks the model frame; otherwise follow the photo's own shape.
    size = photoSize ? photoSize.frame : outputSizeFor(source.width, source.height);
    mimeType = source.mimeType === "image/png" ? "image/png" : "image/jpeg";
  } catch (err) {
    log("generation.source_failed", { jobId, error: String(err) });
    await deps.repo.failJob(job.id, "source_unavailable", "The original photo couldn't be read. Upload it again.", true);
    return;
  }

  const prompt = buildEditPrompt(job.presetSlug, job.instructions, options);
  const safetyIdentifier = createHash("sha256").update(`aabhar:${job.requestedBy}`).digest("hex").slice(0, 64);

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
    const started = now();
    try {
      const result = await provider.editImage({
        image: { bytes: sourceBytes, mimeType, fileName: mimeType === "image/png" ? "source.png" : "source.jpg" },
        prompt,
        size,
        safetyIdentifier,
      });

      await deps.repo.recordAttempt({
        jobId: job.id,
        attemptNo: attempt,
        provider: provider.id,
        model: result.model,
        outcome: "succeeded",
        errorCode: null,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
        usage: result.usage,
        costUsdMicros: result.costUsdMicros,
      });

      const framed = photoSize ? await cropToPhotoSize(result.image, result.mimeType, photoSize) : { image: result.image, mimeType: result.mimeType };
      await storeResult(deps, job, framed.image, framed.mimeType, {
        usage: result.usage,
        costUsdMicros: result.costUsdMicros,
        providerRequestId: result.providerRequestId,
      });
      log("generation.succeeded", { jobId, attempt, latencyMs: result.latencyMs, costUsdMicros: result.costUsdMicros });
      return;
    } catch (err) {
      if (!(err instanceof ProviderError)) {
        log("generation.internal_error", { jobId, attempt, error: String(err) });
        await deps.repo.failJob(job.id, "internal_error", userMessageFor("fatal"), true);
        return;
      }

      await deps.repo.recordAttempt({
        jobId: job.id,
        attemptNo: attempt,
        provider: provider.id,
        model: provider.model,
        outcome: err.category === "timeout" ? "timeout" : err.retryable ? "retryable_error" : "fatal_error",
        errorCode: err.providerCode ?? err.category,
        providerRequestId: err.providerRequestId,
        latencyMs: now() - started,
        usage: null,
        costUsdMicros: null,
      });
      log("generation.provider_error", { jobId, attempt, category: err.category, status: err.status, code: err.providerCode });

      const backoff = Math.min(err.retryAfterMs ?? 3_000 * attempt, 20_000);
      const timeLeft = deadline - now() - backoff;
      const canRetry = err.retryable && attempt < MAX_PROVIDER_ATTEMPTS && timeLeft > 60_000;
      if (!canRetry) {
        await deps.repo.failJob(job.id, err.category, userMessageFor(err.category), true);
        return;
      }
      await sleep(backoff);
    }
  }
}

/**
 * Trims a result to the exact photo-size ratio (centred). The model only
 * makes 1:1, 3:2 and 2:3 frames; the prompt keeps the piece inside the part
 * that survives this trim. Unreadable output is passed on unchanged, and
 * storeResult rejects it.
 */
async function cropToPhotoSize<M extends string>(image: Uint8Array, mimeType: M, size: PhotoSize): Promise<{ image: Uint8Array; mimeType: M | "image/png" }> {
  try {
    const meta = readImageHeader(image);
    if (meta.width * meta.height > PROVIDER_OUTPUT_MAX_PIXELS) return { image, mimeType };
    const box = cropBoxFor(size, meta.width, meta.height);
    if (box.width === meta.width && box.height === meta.height) return { image, mimeType };
    const out = await imageProcessor().transform(image, { cropCentre: { width: box.width, height: box.height }, output: { format: "png" } });
    return { image: out.bytes, mimeType: "image/png" };
  } catch {
    return { image, mimeType };
  }
}

async function storeResult(
  deps: GenerationDeps,
  job: JobRecord,
  image: Uint8Array,
  mimeType: string,
  meta: { usage: import("@/server/providers/image/types").TokenUsage | null; costUsdMicros: number | null; providerRequestId: string | null },
) {
  // Never trust provider bytes blindly: confirm it's a real, sane image.
  let info: { width: number; height: number; format: string };
  try {
    info = readImageHeader(image);
    if (info.width * info.height > PROVIDER_OUTPUT_MAX_PIXELS) throw new Error("output too large");
  } catch {
    await deps.repo.failJob(job.id, "invalid_output", userMessageFor("fatal"), true);
    return;
  }
  const ext = info.format === "jpeg" ? "jpg" : info.format;
  const storagePath = `${job.shopId}/${job.id}/result.${ext}`;
  await deps.storage.upload(BUCKETS.generated, storagePath, image, mimeType);

  const completed = await deps.repo.completeJob({
    jobId: job.id,
    storagePath,
    width: info.width,
    height: info.height,
    bytes: image.byteLength,
    mimeType,
    usage: meta.usage,
    costUsdMicros: meta.costUsdMicros,
    providerRequestId: meta.providerRequestId,
  });
  if (!completed) {
    // The watchdog expired (and refunded) this job meanwhile; don't show a result for a refunded job.
    await deps.storage.remove(BUCKETS.generated, [storagePath]).catch(() => undefined);
  }
}

/* ---------------------------------------------------------------- reading */

export async function getGenerationView(deps: GenerationDeps, userId: string, jobId: string): Promise<GenerationView> {
  const m = await requireMembership(deps, userId, false);
  const job = await deps.repo.getJob(jobId);
  if (!job || job.shopId !== m.shopId) throw domainErrors.notFound("Generation");

  const generated = job.status === "succeeded" ? await deps.repo.getGeneratedImageForJob(job.id) : null;
  const source = await sourceView(deps, job.sourceImageId);

  return {
    id: job.id,
    status: job.status,
    presetSlug: job.presetSlug,
    instructions: job.instructions,
    creditsCharged: job.creditCost,
    creditsRefunded: job.refunded,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.status === "failed" ? { code: job.errorCode ?? "failed", message: job.errorMessage ?? "Generation failed." } : null,
    source,
    result:
      generated && generated.reviewStatus !== "discarded"
        ? {
            generatedImageId: generated.id,
            url: await deps.storage.signedUrl(BUCKETS.generated, generated.storagePath, SIGNED_URL_TTL_SECONDS),
            width: generated.width,
            height: generated.height,
            reviewStatus: generated.reviewStatus,
          }
        : null,
  };
}

export async function reviewGeneration(
  deps: GenerationDeps,
  userId: string,
  jobId: string,
  decision: Exclude<ReviewStatus, "pending">,
) {
  const m = await requireMembership(deps, userId, true);
  const job = await deps.repo.getJob(jobId);
  if (!job || job.shopId !== m.shopId) throw domainErrors.notFound("Generation");
  const generated = await deps.repo.getGeneratedImageForJob(job.id);
  if (!generated) throw new DomainError("conflict", "There is no result to review yet.", 409);
  if (generated.reviewStatus === "discarded") throw new DomainError("conflict", "This result was discarded.", 409);
  await deps.repo.setReviewStatus(generated.id, decision);
}

export async function downloadUrl(deps: GenerationDeps, userId: string, jobId: string): Promise<string> {
  const m = await requireMembership(deps, userId, false);
  const job = await deps.repo.getJob(jobId);
  if (!job || job.shopId !== m.shopId) throw domainErrors.notFound("Generation");
  const generated = await deps.repo.getGeneratedImageForJob(job.id);
  if (!generated || generated.reviewStatus === "discarded") throw domainErrors.notFound("Result");
  const source = await deps.repo.getSourceImage(job.sourceImageId);
  const base = (source?.fileName ?? "jewellery").replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60);
  const ext = generated.storagePath.split(".").pop() ?? "png";
  return deps.storage.signedUrl(BUCKETS.generated, generated.storagePath, 120, `${base}_${job.presetSlug}.${ext}`);
}

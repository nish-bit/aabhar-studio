import type { JobStatus, ReviewStatus } from "@/lib/api-types";
import type { JewelleryTypeId } from "@/lib/jewellery-types";
import type { PhotoSizeId } from "@/lib/photo-sizes";
import type { PresetSlug } from "@/lib/presets";
import type { TokenUsage } from "@/server/providers/image/types";

/**
 * Interfaces the generation service depends on. Production uses Supabase
 * implementations (supabase-repository.ts, supabase-storage.ts); tests use
 * in-memory fakes with the same semantics.
 */

export const BUCKETS = {
  originals: "originals",
  generated: "generated",
  brandAssets: "brand-assets",
  catalogues: "catalogues",
} as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface Membership {
  shopId: string;
  role: "owner" | "editor" | "viewer";
}

export interface SourceImageRecord {
  id: string;
  shopId: string;
  uploadedBy: string;
  fileName: string;
  declaredMimeType: string;
  status: "pending" | "ready" | "rejected";
  /** Path of the raw upload (deleted after sanitising). */
  uploadPath: string;
  /** Path of the sanitised copy used for generation. */
  storagePath: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  shopId: string;
  sourceImageId: string;
  requestedBy: string;
  presetSlug: PresetSlug;
  presetVersion: number;
  instructions: string | null;
  creditCost: number;
  status: JobStatus;
  provider: string;
  model: string;
  errorCode: string | null;
  errorMessage: string | null;
  refunded: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Studio choices stored with a job (generation_jobs.photo_size / jewellery_type). */
export interface JobOptions {
  photoSize: PhotoSizeId | null;
  jewelleryType: JewelleryTypeId | null;
}

export interface GeneratedImageRecord {
  id: string;
  jobId: string;
  shopId: string;
  storagePath: string;
  width: number;
  height: number;
  reviewStatus: ReviewStatus;
}

export interface CreateJobParams {
  userId: string;
  shopId: string;
  sourceImageId: string;
  presetSlug: PresetSlug;
  presetVersion: number;
  instructions: string | null;
  creditCost: number;
  provider: string;
  model: string;
  idempotencyKey: string;
  maxActiveJobs: number;
  dailyLimit: number;
}

export interface AttemptRecord {
  jobId: string;
  attemptNo: number;
  provider: string;
  model: string;
  outcome: "succeeded" | "retryable_error" | "fatal_error" | "timeout";
  errorCode: string | null;
  providerRequestId: string | null;
  latencyMs: number;
  usage: TokenUsage | null;
  costUsdMicros: number | null;
}

export interface CompleteJobParams {
  jobId: string;
  storagePath: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  usage: TokenUsage | null;
  costUsdMicros: number | null;
  providerRequestId: string | null;
}

export interface GenerationRepository {
  /** The user's shop. v1: one shop per user (created at sign-up). */
  getMembership(userId: string): Promise<Membership | null>;
  getBalance(shopId: string): Promise<number>;

  createSourceImage(params: {
    shopId: string;
    userId: string;
    fileName: string;
    declaredMimeType: string;
    sizeBytes: number;
    uploadPath: string;
    id: string;
  }): Promise<void>;
  getSourceImage(id: string): Promise<SourceImageRecord | null>;
  markSourceReady(
    id: string,
    data: { storagePath: string; mimeType: string; width: number; height: number; bytes: number; sha256: string },
  ): Promise<void>;
  markSourceRejected(id: string, reason: string): Promise<void>;
  /** Recent pending uploads, for rate limiting. */
  countRecentUploads(shopId: string, sinceIso: string): Promise<number>;

  /**
   * Atomically: replay check on idempotency key, authorisation, usage limits,
   * credit check, job insert and ledger debit. Throws DomainError.
   */
  createJobWithDebit(params: CreateJobParams): Promise<{ jobId: string; replayed: boolean; balance: number }>;
  /** queued → processing with a lease. Returns null if the job isn't queued. */
  claimJob(jobId: string, leaseSeconds: number): Promise<JobRecord | null>;
  getJob(jobId: string): Promise<JobRecord | null>;
  /**
   * Studio options for a job. Optional, and kept apart from the job row, so
   * a database without migration 20261103000100 still generates (with the
   * original behaviour) instead of failing.
   */
  setJobOptions?(jobId: string, options: JobOptions): Promise<void>;
  getJobOptions?(jobId: string): Promise<JobOptions>;
  recordAttempt(attempt: AttemptRecord): Promise<void>;
  /** processing → succeeded and inserts the generated image. False if no longer processing. */
  completeJob(params: CompleteJobParams): Promise<boolean>;
  /** queued|processing → failed; refunds at most once. False if already terminal. */
  failJob(jobId: string, errorCode: string, errorMessage: string, refund: boolean): Promise<boolean>;
  /** Fails and refunds processing jobs whose lease expired. Returns count. */
  expireStaleJobs(): Promise<number>;

  getGeneratedImageForJob(jobId: string): Promise<GeneratedImageRecord | null>;
  setReviewStatus(generatedImageId: string, status: ReviewStatus): Promise<void>;
}

export interface ObjectStorage {
  createSignedUploadUrl(bucket: Bucket, path: string): Promise<{ token: string; path: string }>;
  download(bucket: Bucket, path: string): Promise<Uint8Array>;
  upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
  signedUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
}

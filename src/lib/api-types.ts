/**
 * JSON contracts between the browser and the API routes.
 * Shared so the client and server can't drift apart.
 */
import type { JewelleryTypeId } from "@/lib/jewellery-types";
import type { PhotoSizeId } from "@/lib/photo-sizes";
import type { PresetSlug } from "@/lib/presets";

export type JobStatus = "queued" | "processing" | "succeeded" | "failed";
export type ReviewStatus = "pending" | "approved" | "discarded";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "invalid_file"
  | "insufficient_credits"
  | "too_many_active_jobs"
  | "daily_limit_reached"
  | "rate_limited"
  | "provider_not_configured"
  | "storage_not_configured"
  | "conflict"
  | "plan_limit"
  | "account_disabled"
  | "billing_not_configured"
  | "payment_failed"
  | "internal_error";

export interface SignUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SignUploadResponse {
  sourceImageId: string;
  bucket: string;
  path: string;
  token: string;
}

export interface SourceImageView {
  id: string;
  fileName: string;
  width: number;
  height: number;
  /** Short-lived signed URL. */
  url: string;
}

export interface CreateGenerationRequest {
  sourceImageId: string;
  presetSlug: PresetSlug;
  instructions?: string;
  /** "3:4" | "1:1" | "16:9" | "9:16"; see src/lib/photo-sizes.ts. */
  photoSize?: PhotoSizeId;
  jewelleryType?: JewelleryTypeId;
}

export interface GenerationView {
  id: string;
  status: JobStatus;
  presetSlug: PresetSlug;
  instructions: string | null;
  creditsCharged: number;
  creditsRefunded: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  source: SourceImageView;
  result: {
    generatedImageId: string;
    url: string;
    width: number;
    height: number;
    reviewStatus: ReviewStatus;
  } | null;
}

export interface CreateGenerationResponse {
  job: GenerationView;
  balance: number;
  /** True when the same Idempotency-Key was already used: no new charge. */
  replayed: boolean;
}

export interface CreditsView {
  balance: number;
}

export interface ReviewRequest {
  decision: "approved" | "discarded";
}

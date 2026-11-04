/**
 * Every adapter maps vendor failures onto these categories so the job
 * runner can decide whether to retry, refund, or alert.
 */
export type ProviderErrorCategory =
  /** 5xx, network failure: safe to retry. */
  | "retryable"
  /** Per-attempt timeout: safe to retry (no image was returned). */
  | "timeout"
  /** 429 rate limit: retry after a delay. */
  | "rate_limited"
  /** Account out of quota or billing problem: don't retry. */
  | "quota_exceeded"
  /** Bad key or organisation not verified: don't retry, alert. */
  | "auth"
  /** The provider's safety system refused the request. */
  | "content_blocked"
  /** The image or parameters were rejected. */
  | "invalid_input"
  /** Unexpected response shape or anything else. */
  | "fatal";

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly retryAfterMs: number | null;
  readonly providerRequestId: string | null;

  constructor(
    category: ProviderErrorCategory,
    message: string,
    opts: {
      status?: number | null;
      providerCode?: string | null;
      retryAfterMs?: number | null;
      providerRequestId?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderError";
    this.category = category;
    this.status = opts.status ?? null;
    this.providerCode = opts.providerCode ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.providerRequestId = opts.providerRequestId ?? null;
  }

  get retryable(): boolean {
    return this.category === "retryable" || this.category === "timeout" || this.category === "rate_limited";
  }
}

/** Plain-language message for shop owners. Never includes vendor internals. */
export function userMessageFor(category: ProviderErrorCategory): string {
  switch (category) {
    case "content_blocked":
      return "The image service declined this photo. Try a different photo or remove your custom instructions.";
    case "invalid_input":
      return "The image service couldn't use this photo. Try a sharper JPG or PNG with the piece filling most of the frame.";
    case "rate_limited":
    case "retryable":
    case "timeout":
      return "The image service is busy or didn't respond in time. Please try again in a few minutes.";
    case "quota_exceeded":
    case "auth":
      return "Image generation is temporarily unavailable. Our team has been alerted.";
    default:
      return "Something went wrong while generating this image. Please try again.";
  }
}

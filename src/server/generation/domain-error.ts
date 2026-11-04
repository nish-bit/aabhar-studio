import type { ApiErrorCode } from "@/lib/api-types";

/** An expected, user-facing failure with a stable code and HTTP status. */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const domainErrors = {
  unauthenticated: () => new DomainError("unauthenticated", "Please sign in.", 401),
  forbidden: () => new DomainError("forbidden", "You don't have access to this.", 403),
  accountDisabled: () =>
    new DomainError("account_disabled", "This account has been disabled. Contact support if you think this is a mistake.", 403),
  notFound: (what = "Item") => new DomainError("not_found", `${what} not found.`, 404),
  insufficientCredits: (needed: number, balance: number) =>
    new DomainError(
      "insufficient_credits",
      `This look needs ${needed} ${needed === 1 ? "credit" : "credits"} and you have ${balance}.`,
      402,
    ),
  tooManyActive: (max: number) =>
    new DomainError("too_many_active_jobs", `You can run up to ${max} generations at once. Wait for one to finish.`, 429),
  dailyLimit: () => new DomainError("daily_limit_reached", "You've reached today's generation limit. Try again tomorrow.", 429),
  rateLimited: () => new DomainError("rate_limited", "Too many requests. Please wait a moment.", 429),
  providerNotConfigured: () =>
    new DomainError(
      "provider_not_configured",
      "Image generation isn't connected yet. An administrator needs to add the image provider key.",
      503,
    ),
};

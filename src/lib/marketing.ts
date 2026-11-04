/**
 * Marketing email consent: the wording users agree to and the shapes the
 * API returns. Shared by the browser and the server.
 */

/**
 * Bump the version whenever the wording changes, so each consent record
 * shows exactly which text the user agreed to.
 */
export const MARKETING_CONSENT = {
  version: "2026-11-01",
  text: "I agree to receive marketing emails, product updates, offers, and newsletters from Aabhar Studio. I can unsubscribe at any time.",
} as const;

/** Short-lived cookie that carries the sign-up checkbox through Google sign-in to /auth/callback. */
export const SIGNUP_CONSENT_COOKIE = "aabhar_marketing_optin";

/** "none": never opted in (no record). */
export type MarketingStatus = "subscribed" | "unsubscribed" | "pending" | "none";

export interface MarketingPreferences {
  email: string | null;
  status: MarketingStatus;
  consentAt: string | null;
  unsubscribedAt: string | null;
}

export interface UpdateMarketingPreferences {
  subscribed: boolean;
}

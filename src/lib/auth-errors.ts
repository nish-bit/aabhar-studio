/**
 * Classifies Supabase Auth errors. Only errors that Supabase uses to say "this
 * browser has no valid session" (missing, expired, revoked, or for a user who no
 * longer exists or is banned) count as signed out. Everything else (network
 * failures, rate limits, 5xx, configuration problems such as a wrong key, and any
 * error we don't recognise) is a service failure: the caller must keep the
 * session cookies and show an error, never send a signed-in user to /login.
 *
 * Shared by the proxy and server code, so it has no server-only imports.
 */

/** Supabase Auth error codes (lib/error-codes) that mean the session is gone or unusable. */
export const SIGNED_OUT_ERROR_CODES: ReadonlySet<string> = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "bad_jwt",
  "no_authorization",
  "user_not_found",
  "user_banned",
]);

export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

export function isSignedOutError(error: AuthErrorLike): boolean {
  // Thrown locally by supabase-js when there are no session cookies at all.
  if (error.name === "AuthSessionMissingError") return true;
  if (typeof error.code !== "string" || !SIGNED_OUT_ERROR_CODES.has(error.code)) return false;
  // A known code with a rate-limit or server status is still an outage.
  return error.status === undefined || (error.status >= 400 && error.status < 500 && error.status !== 429);
}

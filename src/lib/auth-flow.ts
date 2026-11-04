import { billingConfig } from "@/config/billing";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * The /login URL for a signed-out visitor who asked for `pathname?search`.
 * The query string is kept so a plan or pack chosen on the pricing page
 * survives sign-in (e.g. /app/billing?plan=growth).
 */
export function loginPathFor(pathname: string, search: string): string {
  const next = safeNextPath(`${pathname}${search}`, "/app/dashboard");
  return `/login?next=${encodeURIComponent(next)}`;
}

/** What the visitor is signing in to do, shown above the button. Only known pack ids are named. */
export function signInPurpose(next: string | null | undefined): string | null {
  const target = safeNextPath(next, "");
  if (!target.startsWith("/app/billing")) return null;
  const params = new URL(target, "https://app.invalid").searchParams;
  const pack = billingConfig.packs.find((p) => p.id === params.get("pack"));
  if (pack) return `Sign in to continue to the ${pack.name} credit pack. You'll review it before anything is charged.`;
  return "Sign in to continue to billing.";
}

/** Where Google (via Supabase) sends the user back, carrying the page they were heading to. */
export function oauthCallbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

export const LOGIN_ERRORS = {
  cancelled: "Google sign-in was cancelled. You can try again whenever you're ready.",
  failed: "We couldn't sign you in with Google. Please try again.",
  expired: "That sign-in link expired or was opened in a different browser. Please try again here.",
  callback: "The sign-in response was incomplete. Please try again.",
  unavailable: "Sign-in isn't available right now. Please try again later.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export function loginErrorPath(code: LoginErrorCode, next: string): string {
  return `/login?error=${code}&next=${encodeURIComponent(safeNextPath(next))}`;
}

/** Only fixed messages are shown; anything else in ?error= is ignored. */
export function loginErrorMessage(code: string | null | undefined): string | null {
  return code && Object.hasOwn(LOGIN_ERRORS, code) ? LOGIN_ERRORS[code as LoginErrorCode] : null;
}

import { NextResponse } from "next/server";

import { loginErrorPath, type LoginErrorCode } from "@/lib/auth-flow";
import { MARKETING_CONSENT, SIGNUP_CONSENT_COOKIE } from "@/lib/marketing";
import { safeNextPath } from "@/lib/safe-redirect";
import { database } from "@/server/db/postgres";
import { supabaseForRequest } from "@/server/db/supabase-server";
import { subscribe } from "@/server/marketing/consent";
import { recordReferral, REFERRAL_COOKIE } from "@/server/referrals/service";

/**
 * Google sign-in returns here (via Supabase) with a one-time `code`. We swap
 * it for a session cookie on the server (PKCE: the verifier was stored in a
 * cookie when the flow started), then send the user where they were heading.
 * Any failure goes back to /login with a fixed error code — provider error
 * text is never shown or reflected.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const back = (code: LoginErrorCode) => NextResponse.redirect(new URL(loginErrorPath(code, next), url.origin), { status: 303 });

  const providerError = url.searchParams.get("error");
  if (providerError) {
    // Google returns access_denied when the user cancels on the consent screen.
    const cancelled = providerError === "access_denied";
    if (!cancelled) log("auth.oauth_provider_error", { error: providerError, code: url.searchParams.get("error_code") });
    return back(cancelled ? "cancelled" : "failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return back("callback");

  const supabase = await supabaseForRequest();
  if (!supabase) return back("unavailable");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Classified by Supabase's error code only, never by message text: a code/verifier mismatch
    // (bad_code_verifier) mentions "verifier" but is a failed sign-in, not an expired one.
    const expired = typeof error.code === "string" && EXPIRED_FLOW_CODES.has(error.code);
    // The same callback URL opened twice (a reload, Back, or a duplicate request) finds its code and
    // verifier already used by the first, successful exchange. If this browser is signed in, that
    // sign-in worked: continue instead of showing "link expired". Only the expired-flow codes
    // qualify. No session is created here: the exchange failed, and getUser() only verifies the
    // session this browser's own cookies already hold.
    if (expired && (await hasVerifiedSession(supabase))) {
      log("auth.oauth_code_already_used", { code: error.code ?? null });
      return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
    }
    log("auth.oauth_exchange_failed", { code: error.code ?? null, status: error.status ?? null });
    return back(expired ? "expired" : "failed");
  }
  const user = data?.user ?? data?.session?.user ?? null;
  await ensureShop(user?.id ?? null);
  const res = NextResponse.redirect(new URL(next, url.origin), { status: 303 });
  const referralCode = readCookie(req, REFERRAL_COOKIE);
  if (referralCode !== null) {
    if (user && isNewAccount(user)) await recordInvite(user.id, referralCode);
    res.cookies.set(REFERRAL_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
  }
  if (readCookie(req, SIGNUP_CONSENT_COOKIE) !== null) {
    await recordSignInConsent(req, user);
    res.cookies.set(SIGNUP_CONSENT_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
  }
  return res;
}

/**
 * Exchange errors meaning the sign-in flow is used up or expired: Supabase has no flow state for the
 * code (already exchanged, or too old), or this browser has no PKCE verifier cookie (consumed by an
 * earlier exchange, or the flow started in another browser). These show "expired", and only these
 * may continue with an existing, verified session.
 */
const EXPIRED_FLOW_CODES: ReadonlySet<string> = new Set(["flow_state_not_found", "flow_state_expired", "pkce_code_verifier_not_found"]);

/** True only when Supabase confirms this browser's existing session; any error counts as no session. */
async function hasVerifiedSession(supabase: NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

/**
 * Makes sure the user has their shop (idempotent; normally the sign-up
 * trigger already did this). Covers accounts the trigger never saw, which
 * otherwise get "You don't have access to this" everywhere. Never blocks
 * sign-in: a failure is logged and the app pages show their usual errors.
 */
async function ensureShop(userId: string | null) {
  if (!userId) return;
  const db = database();
  if (!db) return;
  try {
    await db.query("select public.ensure_user_shop($1::uuid)", [userId]);
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.ensure_shop_failed", userId, error: String(err).slice(0, 200) }));
  }
}

/** Accounts created in the last 10 minutes are sign-ups; older ones are returning users. */
function isNewAccount(user: { created_at?: string }): boolean {
  return user.created_at ? Date.now() - Date.parse(user.created_at) < 10 * 60_000 : false;
}

/** A brand-new account that arrived through an invite link. Never blocks sign-in. */
async function recordInvite(userId: string, code: string) {
  const db = database();
  if (!db) return;
  try {
    await recordReferral(db, userId, code);
  } catch (err) {
    console.error(JSON.stringify({ event: "referral.record_failed", userId, error: String(err).slice(0, 200) }));
  }
}

/**
 * The login page's optional marketing checkbox, carried here in a cookie.
 * Only the current wording's version counts as consent. A failure here is
 * logged and never blocks sign-in.
 */
async function recordSignInConsent(req: Request, user: { id: string; created_at?: string } | null) {
  if (!user || readCookie(req, SIGNUP_CONSENT_COOKIE) !== MARKETING_CONSENT.version) return;
  const db = database();
  if (!db) return;
  try {
    // Accounts created in the last 10 minutes count as sign-ups; anyone else ticked it while signing in.
    await subscribe(db, user.id, isNewAccount(user) ? "signup" : "sign_in");
  } catch (err) {
    console.error(JSON.stringify({ event: "marketing.signup_consent_failed", userId: user.id, error: String(err).slice(0, 200) }));
  }
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function log(event: string, fields: Record<string, unknown>) {
  console.warn(JSON.stringify({ event, ...fields }));
}

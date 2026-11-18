import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isSignedOutError } from "@/lib/auth-errors";
import { loginErrorPath, loginPathFor } from "@/lib/auth-flow";
import { safeNextPath } from "@/lib/safe-redirect";

const DASHBOARD = "/app/dashboard";

/**
 * Refreshes the Supabase session cookie on app and API requests and sends
 * signed-out visitors from /app to /login. This is an optimistic check
 * only — every route handler verifies the user again server-side.
 */
export async function proxy(request: NextRequest) {
  // The homepage is only matched so Supabase Auth errors land on the login page (see authErrorRedirect),
  // and a sign-in code that Supabase sent to the Site URL still reaches the callback (see stray code forwarding).
  if (request.nextUrl.pathname === "/") return authErrorRedirect(request) ?? strayCodeForward(request) ?? NextResponse.next();
  // There is no /dashboard page (the dashboard is /app/dashboard); old links and typed URLs used to 404.
  // Same Supabase error and stray-code handling as "/", in case a Site URL or redirect points here.
  if (request.nextUrl.pathname === "/dashboard") {
    return authErrorRedirect(request) ?? strayCodeForward(request) ?? NextResponse.redirect(new URL(DASHBOARD, request.url), { status: 308 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();

  // The cookies as the browser sent them, to undo a removal made during a failed check (below).
  const original = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
  // Every cookie Supabase writes during this request, latest per name. @supabase/ssr calls setAll once
  // per auth event (e.g. TOKEN_REFRESHED, then SIGNED_OUT), so the response must carry all of them,
  // not just the last batch: dropping a rotated refresh token signs the user out.
  const writes: SessionWrites = { cookies: new Map(), headers: new Map(), rotated: false };
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const cookie of toSet) {
          request.cookies.set(cookie.name, cookie.value);
          writes.cookies.set(cookie.name, cookie);
          if (cookie.value !== "") writes.rotated = true;
        }
        Object.entries(headers ?? {}).forEach(([k, v]) => writes.headers.set(k, v));
        response = NextResponse.next({ request });
        writes.cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        writes.headers.forEach((v, k) => response.headers.set(k, v));
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && error && !isSignedOutError(error)) {
    // Supabase unreachable, rate-limited, failing, misconfigured or an unknown error: not the same as
    // signed out. Don't send a signed-in user to /login (and don't bounce /login either); keep the
    // session cookies, and let the page's own getSessionUser() check show its error screen with
    // "Try again". Never log tokens or cookie values.
    console.warn(JSON.stringify({ event: "auth.proxy_get_user_failed", name: error.name, code: error.code ?? null, status: error.status ?? null }));
    return keepSessionOnFailure(request, response, writes, original);
  }
  // A redirect is a new response: carry over any session cookies Supabase just
  // refreshed, or the browser keeps the old (already rotated) refresh token and
  // the next request finds no session.
  const redirect = (to: string) => {
    const res = NextResponse.redirect(new URL(to, request.url));
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };
  if (!data.user && (path.startsWith("/app") || path.startsWith("/admin"))) {
    // Keep the query string so a plan picked on /pricing survives sign-in.
    return redirect(loginPathFor(path, request.nextUrl.search));
  }
  if (data.user && path === "/login") {
    // Already signed in: skip the form and go where they were heading.
    return redirect(safeNextPath(request.nextUrl.searchParams.get("next")));
  }
  return response;
}

type SessionCookieWrite = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };
interface SessionWrites {
  /** Latest write per cookie name, across every setAll call in this request. */
  cookies: Map<string, SessionCookieWrite>;
  headers: Map<string, string>;
  /** Supabase wrote a new session value at some point (a token refresh): the old refresh token is spent. */
  rotated: boolean;
}

/**
 * After a service failure (not a sign-out), make sure the browser keeps its session:
 * - Supabase rotated the session at any point in this request: keep the final state whole. The old
 *   refresh token is spent, so restoring it would not help, and dropping a new one would really sign
 *   the user out; any cleared cookies are stale chunks of the old value.
 * - Supabase only cleared cookies (supabase-js drops an expired session when a refresh fails with an
 *   error it doesn't treat as retryable, such as a 429): undo that for the page and send the browser
 *   no cookie changes at all, so a rate limit or outage never signs anyone out.
 */
function keepSessionOnFailure(request: NextRequest, response: NextResponse, writes: SessionWrites, original: Map<string, string>): NextResponse {
  if (writes.cookies.size === 0 || writes.rotated) return response;
  for (const name of writes.cookies.keys()) {
    const value = original.get(name);
    if (value === undefined) request.cookies.delete(name);
    else request.cookies.set(name, value);
  }
  const kept = NextResponse.next({ request });
  writes.headers.forEach((v, k) => kept.headers.set(k, v));
  return kept;
}

/**
 * When Supabase can't tie a Google response to a sign-in it started (for
 * example "OAuth state has expired": the Google page was left open too long,
 * reloaded, or finished in another browser), it sends the user to the Site
 * URL root with ?error=…&error_code=…. Send them to the login page with a
 * fixed, friendly message instead of silently showing the homepage. Supabase
 * has already rejected the attempt; nothing here bypasses any check.
 */
function authErrorRedirect(request: NextRequest): NextResponse | null {
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (!error || (!params.has("error_code") && !params.has("error_description"))) return null;
  const code = params.get("error_code") ?? "";
  const reason = error === "access_denied" ? "cancelled" : /state|flow_state|expired/i.test(code) ? "expired" : "failed";
  console.warn(JSON.stringify({ event: "auth.oauth_error_at_root", error: error.slice(0, 60), code: code.slice(0, 60) }));
  return NextResponse.redirect(new URL(loginErrorPath(reason, DASHBOARD), request.url), { status: 303 });
}

/** Supabase PKCE auth codes are UUIDs; accept that shape (with some slack) and nothing else. */
const AUTH_CODE = /^[A-Za-z0-9-]{8,128}$/;
/** Fixed destination: Supabase already dropped the original `next` when it fell back to the Site URL. */
const STRAY_CODE_DESTINATION = DASHBOARD;

/**
 * When the redirect URL the app asked for isn't on Supabase's Redirect URLs allow-list,
 * Supabase falls back to the Site URL root and appends ?code=…, so the code never reaches
 * /auth/callback and the user stays signed out on the homepage. Forward it to the callback,
 * which exchanges it exactly as usual: the code is single-use and only works together with
 * the PKCE verifier cookie this browser set when the sign-in started, so this bypasses no
 * check. Only a well-formed `code` with no OAuth `error` is forwarded (errors are handled by
 * authErrorRedirect, which runs first). /auth/callback isn't matched by this proxy and never
 * redirects to "/", so this can't loop. The fix for the cause is the Supabase allow-list;
 * the warning says so and never includes the code.
 */
function strayCodeForward(request: NextRequest): NextResponse | null {
  const params = request.nextUrl.searchParams;
  if (params.has("error") || params.has("error_code") || params.has("error_description")) return null;
  const code = params.get("code");
  if (!code || params.getAll("code").length !== 1 || !AUTH_CODE.test(code)) return null;
  console.warn(
    JSON.stringify({
      event: "auth.oauth_code_at_root",
      detail: "Supabase returned the sign-in to the Site URL: add this site's /auth/callback to Authentication → URL Configuration → Redirect URLs.",
    }),
  );
  const target = new URL("/auth/callback", request.url);
  target.searchParams.set("code", code);
  target.searchParams.set("next", safeNextPath(STRAY_CODE_DESTINATION));
  return NextResponse.redirect(target, { status: 303 });
}

export const config = {
  // Webhooks, cron and internal routes (queue consumer, selftest) authenticate
  // with signatures/secrets, not cookies, so they skip the session refresh.
  // "/" only for Supabase Auth error redirects and stray sign-in codes; it returns before any session work.
  // "/dashboard" only redirects to /app/dashboard (same early handling as "/").
  matcher: ["/", "/dashboard", "/app/:path*", "/admin/:path*", "/admin", "/api/((?!webhooks/|cron/|internal/|health).*)", "/login"],
};

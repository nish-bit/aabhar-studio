import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { loginErrorPath, loginPathFor } from "@/lib/auth-flow";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Refreshes the Supabase session cookie on app and API requests and sends
 * signed-out visitors from /app to /login. This is an optimistic check
 * only — every route handler verifies the user again server-side.
 */
export async function proxy(request: NextRequest) {
  // The homepage is only matched so Supabase Auth errors land on the login page (see authErrorRedirect),
  // and a sign-in code that Supabase sent to the Site URL still reaches the callback (see stray code forwarding).
  if (request.nextUrl.pathname === "/") return authErrorRedirect(request) ?? strayCodeForward(request) ?? NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
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
  return NextResponse.redirect(new URL(loginErrorPath(reason, "/app/dashboard"), request.url), { status: 303 });
}

/** Supabase PKCE auth codes are UUIDs; accept that shape (with some slack) and nothing else. */
const AUTH_CODE = /^[A-Za-z0-9-]{8,128}$/;
/** Fixed destination: Supabase already dropped the original `next` when it fell back to the Site URL. */
const STRAY_CODE_DESTINATION = "/app/dashboard";

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
  matcher: ["/", "/app/:path*", "/admin/:path*", "/admin", "/api/((?!webhooks/|cron/|internal/|health).*)", "/login"],
};

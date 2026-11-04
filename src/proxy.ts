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
  // The homepage is only matched so Supabase Auth errors land on the login page (see authErrorRedirect).
  if (request.nextUrl.pathname === "/") return authErrorRedirect(request) ?? NextResponse.next();

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

export const config = {
  // Webhooks and cron authenticate with signatures/secrets, not cookies.
  // "/" only for Supabase Auth error redirects; it returns before any session work.
  matcher: ["/", "/app/:path*", "/admin/:path*", "/admin", "/api/((?!webhooks/|cron/|health).*)", "/login"],
};

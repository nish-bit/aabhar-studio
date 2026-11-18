import { NextResponse } from "next/server";

import { supabaseForRequest } from "@/server/db/supabase-server";

/**
 * Sign out, used by every "Sign out" button (app header and Settings). Ends
 * the Supabase session first, then shows the public homepage. Same-site POST
 * only, so another site can't sign people out.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden" } }, { status: 403 });
  }

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.headers.set("Cache-Control", "no-store");

  // Idempotent: a repeated sign-out (double submit, Back + resubmit, second tab) has no session
  // cookies left, so there is nothing to end. Skip the Supabase call and just go home.
  if (sessionCookieNames(req).length === 0) return res;

  const supabase = await supabaseForRequest();
  const result = supabase ? await supabase.auth.signOut() : null;

  if (result?.error) {
    // Supabase keeps the cookies when it can't even load the session (e.g. a
    // network error while refreshing). Clear them here so the browser is
    // signed out regardless; the server-side session expires on its own.
    console.warn(JSON.stringify({ event: "auth.sign_out_error", name: result.error.name, status: result.error.status ?? null }));
    for (const name of sessionCookieNames(req)) res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

/**
 * Supabase Auth cookie names, as @supabase/ssr writes them. The storage key is
 * `sb-<first label of the Supabase hostname>-auth-token` (the label can contain
 * hyphens with a custom domain); a large session is split into `<key>.0`, `<key>.1`, …;
 * sign-in adds `<key>-code-verifier`, `<key>-flows-code-verifier` and
 * `<key>-flow-<id>-code-verifier`.
 */
const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+|-code-verifier|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier)?$/;

/** Names of the Supabase Auth cookies this request carries (names only; values are never read). */
function sessionCookieNames(req: Request): string[] {
  return (req.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("=")[0]?.trim() ?? "")
    .filter((name) => SUPABASE_AUTH_COOKIE.test(name));
}

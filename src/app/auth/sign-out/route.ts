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

  const supabase = await supabaseForRequest();
  const result = supabase ? await supabase.auth.signOut() : null;

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.headers.set("Cache-Control", "no-store");

  if (result?.error) {
    // Supabase keeps the cookies when it can't even load the session (e.g. a
    // network error while refreshing). Clear them here so the browser is
    // signed out regardless; the server-side session expires on its own.
    console.warn(JSON.stringify({ event: "auth.sign_out_error", name: result.error.name, status: result.error.status ?? null }));
    for (const name of sessionCookieNames(req)) res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

/** Supabase session cookies (`sb-<project>-auth-token`, its `.0`/`.1` chunks and the PKCE verifier). */
function sessionCookieNames(req: Request): string[] {
  return (req.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter((name) => /^sb-[a-z0-9]+-auth-token/.test(name));
}

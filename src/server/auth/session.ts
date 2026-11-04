import "server-only";

import { connection } from "next/server";

import { supabaseForRequest } from "@/server/db/supabase-server";

export interface SessionUser {
  id: string;
  email: string | null;
  /** Display name from the Google profile (Supabase user metadata), when Google shares one. */
  name?: string | null;
}

/**
 * The verified current user, or null. Uses getUser(), which validates the
 * token with Supabase Auth rather than trusting the cookie contents.
 *
 * A session only exists at request time, so this marks the caller as
 * request-time with connection() first. Supabase Auth reads the clock
 * (token expiry), which Cache Components refuses during prerendering.
 */
/** Auth errors that mean "there is no valid session", as opposed to an outage. */
export function isSignedOutError(error: { name?: string; status?: number }): boolean {
  if (error.name === "AuthSessionMissingError") return true;
  return typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 429;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  await connection();
  const supabase = await supabaseForRequest();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // No session, or an invalid/expired one: signed out.
    if (isSignedOutError(error)) return null;
    // Supabase unreachable, rate-limited or failing: not the same as signed out.
    // Treating it as signed out sends pages to /login while the proxy (whose own
    // check succeeded) sends /login back, a redirect loop. Fail loudly instead;
    // the page's error boundary offers "Try again". Never log tokens.
    console.error(JSON.stringify({ event: "auth.get_user_failed", name: error.name, code: error.code ?? null, status: error.status ?? null }));
    throw new Error(`Couldn't verify the session (${error.status ?? error.name})`);
  }
  if (!data.user) return null;
  const meta = data.user.user_metadata ?? {};
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  return { id: data.user.id, email: data.user.email ?? null, name: name?.trim().slice(0, 120) || null };
}

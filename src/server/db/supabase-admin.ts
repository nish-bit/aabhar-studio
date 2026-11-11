import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/server/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so every caller must check
 * authorisation first. Never import this from client code.
 */
export function supabaseAdmin(): SupabaseClient | null {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  if (!admin) {
    admin = createClient(cfg.url, cfg.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithDeadline },
    });
  }
  return admin;
}

/** Server-to-Supabase requests (database API, storage) give up after this long instead of waiting forever. */
export const SUPABASE_TIMEOUT_MS = 30_000;

/** fetch with a deadline, combined with any signal the caller passed (e.g. a shorter one for public pricing). */
const fetchWithDeadline: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return fetch(input, { ...init, signal });
};

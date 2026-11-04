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
    });
  }
  return admin;
}

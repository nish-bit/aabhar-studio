import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/server/env";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function supabaseForRequest(): Promise<SupabaseClient | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes cookies instead.
        }
      },
    },
  });
}

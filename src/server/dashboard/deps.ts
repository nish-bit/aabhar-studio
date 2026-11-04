import "server-only";

import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { SupabaseObjectStorage } from "@/server/generation/supabase-storage";

import type { DashboardDeps } from "./service";

/** Production wiring, or null when the database or storage isn't configured (pages show a setup notice). */
export function dashboardDeps(): DashboardDeps | null {
  const db = database();
  const admin = supabaseAdmin();
  if (!db || !admin) return null;
  return { db, storage: new SupabaseObjectStorage(admin) };
}

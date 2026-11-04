import "server-only";

import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";

/**
 * Whether an admin has disabled this account. Checked on every customer API
 * request and app page, so a disable takes effect immediately, even for
 * sessions that are still signed in. (Job creation also checks it in SQL.)
 */
export async function isAccountDisabled(userId: string): Promise<boolean> {
  const db = database();
  if (db) {
    const rows = await db.query<{ disabled: boolean }>(`select disabled_at is not null as disabled from public.profiles where id = $1`, [userId]);
    return rows[0]?.disabled ?? false;
  }
  const admin = supabaseAdmin();
  if (!admin) return false;
  const { data, error } = await admin.from("profiles").select("disabled_at").eq("id", userId).maybeSingle();
  if (error) throw new Error(`account status lookup failed: ${error.message}`);
  return Boolean(data?.disabled_at);
}

import { timingSafeEqual } from "node:crypto";

import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { serverEnv } from "@/server/env";
import { SupabaseObjectStorage } from "@/server/generation/supabase-storage";
import { errorResponse, json } from "@/server/http/respond";
import { runRetention } from "@/server/privacy/retention";

export const maxDuration = 300;

/** Daily data-retention sweep (see src/server/privacy/retention.ts). `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = !!secret && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) return errorResponse("unauthenticated", "Unauthorized.", 401);
  const db = database();
  const admin = supabaseAdmin();
  if (!db || !admin) return errorResponse("storage_not_configured", "Database and storage must be configured.", 503);
  const result = await runRetention({ db, storage: new SupabaseObjectStorage(admin) });
  console.info(JSON.stringify({ event: "retention.completed", ...result }));
  return json(result);
}

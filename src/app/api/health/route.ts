import { connection } from "next/server";

import { database } from "@/server/db/postgres";
import { integrationStatus } from "@/server/env";
import { billingConfigState } from "@/server/billing/config";

/**
 * Uptime check. Public, so it reveals only booleans — never configuration
 * values, counts or customer data. 503 when the database is unreachable.
 */
export async function GET() {
  await connection();
  const status = integrationStatus();
  let db = false;
  const started = Date.now();
  try {
    const conn = database();
    if (conn) db = (await conn.query<{ ok: number }>("select 1 as ok"))[0]?.ok === 1;
  } catch {
    db = false;
  }
  const body = {
    ok: db,
    database: db,
    dbLatencyMs: Date.now() - started,
    auth: status.supabase,
    imageProvider: status.imageProvider,
    payments: billingConfigState().availability.enabled,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  };
  return Response.json(body, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

/**
 * Deletes a customer's content at their verified request.
 *
 *   npm run account:delete -- --email customer@example.com --admin you@example.com --reason "Request #123"          # dry run
 *   npm run account:delete -- --email customer@example.com --admin you@example.com --reason "Request #123" --apply
 *
 * Needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY. The
 * --admin account must hold the admin role; the action is written to the
 * audit log. See docs/PRIVACY.md for what is deleted and what is kept.
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { postgresSsl } from "../src/server/db/ssl";

import { requireAdmin } from "@/server/admin/guard";
import type { Db, SqlParam } from "@/server/db/sql";
import { SupabaseObjectStorage } from "@/server/generation/supabase-storage";
import { deleteAccountData } from "@/server/privacy/delete-account";

const { values } = parseArgs({
  options: { email: { type: "string" }, admin: { type: "string" }, reason: { type: "string" }, apply: { type: "boolean", default: false } },
});

async function main() {
  const { email, admin: adminEmail, reason, apply } = values;
  const url = process.env.DATABASE_URL;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!email || !adminEmail || !reason) throw new Error("Usage: --email <customer> --admin <your admin email> --reason <text> [--apply]");
  if (!url || !supaUrl || !key) throw new Error("DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");

  const sql = postgres(url, { prepare: false, max: 1, ssl: postgresSsl(url) });
  const wrap = (c: postgres.Sql | postgres.TransactionSql): Db => ({
    query: async <T,>(text: string, params: SqlParam[] = []) => (await c.unsafe(text, params as never[])) as unknown as T[],
    transaction: async <T,>(fn: (tx: Db) => Promise<T>) => ("savepoint" in c ? fn(wrap(c)) : ((await (c as postgres.Sql).begin((tx) => fn(wrap(tx)))) as T)),
  });
  const db = wrap(sql);
  const supabase = createClient(supaUrl, key, { auth: { persistSession: false } });
  try {
    const find = async (e: string) => (await db.query<{ id: string; email: string }>(`select id, email from auth.users where lower(email) = lower($1)`, [e]))[0];
    const actor = await find(adminEmail);
    const target = await find(email);
    if (!actor) throw new Error(`No account for ${adminEmail}.`);
    if (!target) throw new Error(`No account for ${email}.`);
    const ctx = await requireAdmin(db, { id: actor.id, email: actor.email }, "write", { ip: null, userAgent: "scripts/delete-account.ts" });
    const result = await deleteAccountData(
      {
        db,
        storage: new SupabaseObjectStorage(supabase),
        authAdmin: {
          async anonymize(userId) {
            const { error } = await supabase.auth.admin.updateUserById(userId, { email: `deleted-${userId}@deleted.invalid`, ban_duration: "876000h", user_metadata: {} });
            if (error) throw new Error(error.message);
          },
        },
      },
      ctx,
      { userId: target.id, reason, apply },
    );
    console.log(JSON.stringify(result, null, 2));
    if (!apply) console.log("\nDry run only. Re-run with --apply to delete.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

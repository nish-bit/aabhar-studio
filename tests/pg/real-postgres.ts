import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import type { Db, SqlParam } from "@/server/db/sql";

/**
 * A throwaway database on a real PostgreSQL server, for what PGlite can't
 * do: genuinely concurrent connections and real role switching.
 * Set TEST_DATABASE_URL (a superuser connection, e.g. a CI Postgres service).
 */
export const REAL_PG_URL = process.env.TEST_DATABASE_URL;

const root = path.resolve(import.meta.dirname, "../..");

function wrap(c: postgres.Sql | postgres.TransactionSql): Db {
  return {
    query: async <T,>(text: string, params: SqlParam[] = []) => (await c.unsafe(text, params as never[])) as unknown as T[],
    transaction: async <T,>(fn: (tx: Db) => Promise<T>) =>
      "savepoint" in c ? fn(wrap(c)) : ((await (c as postgres.Sql).begin((tx) => fn(wrap(tx)))) as T),
  };
}

export async function createRealDatabase(poolSize = 12) {
  const admin = postgres(REAL_PG_URL!, { max: 1, onnotice: () => undefined });
  const name = `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(REAL_PG_URL!);
  url.pathname = `/${name}`;
  const setup = postgres(url.toString(), { max: 1, onnotice: () => undefined });
  // Roles are cluster-wide; create them only if missing (another run may have).
  await setup.unsafe(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "supabase/migrations")).sort()) {
    await setup.begin((tx) => tx.unsafe(readFileSync(path.join(root, "supabase/migrations", f), "utf8")));
  }
  await setup.end();
  const sql = postgres(url.toString(), { max: poolSize, prepare: false, onnotice: () => undefined });
  return {
    sql,
    db: wrap(sql),
    async drop() {
      await sql.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

export async function realUser(sql: postgres.Sql) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@qa.test`})`;
  const [m] = await sql<{ shop_id: string }[]>`select shop_id from public.shop_members where user_id = ${id}`;
  return { userId: id, shopId: m!.shop_id };
}

export async function realSource(sql: postgres.Sql, shopId: string, userId: string) {
  const id = randomUUID();
  await sql`insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
              storage_path, mime_type, width, height, status)
            values (${id}, ${shopId}, ${userId}, 'p.jpg', 'image/jpeg', 1000, ${`${shopId}/${id}/u.jpg`}, ${`${shopId}/${id}/s.jpg`},
                    'image/jpeg', 1200, 1200, 'ready')`;
  return id;
}

/** Runs `fn` as a signed-in customer (role `authenticated`, auth.uid() = userId) in its own transaction. */
export async function asCustomer<T>(sql: postgres.Sql, userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe(userId ? "set local role authenticated" : "set local role anon");
    if (userId) await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return fn(tx);
  })) as T;
}

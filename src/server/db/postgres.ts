import "server-only";

import postgres from "postgres";

import { serverEnv } from "@/server/env";

import type { Db, SqlParam } from "./sql";

type Client = postgres.Sql | postgres.TransactionSql;

function wrap(client: Client): Db {
  return {
    async query<T>(text: string, params: SqlParam[] = []) {
      const rows = await client.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if ("savepoint" in client) return fn(wrap(client));
      return (client as postgres.Sql).begin((tx) => fn(wrap(tx))) as Promise<T>;
    },
  };
}

let db: Db | null = null;

/**
 * Direct connection to the Supabase database for server code. Use the
 * transaction-mode pooler URL (port 6543); prepared statements are off,
 * which that mode requires. Returns null when DATABASE_URL isn't set.
 */
export function database(): Db | null {
  const url = serverEnv().DATABASE_URL;
  if (!url) return null;
  if (!db) {
    db = wrap(
      postgres(url, {
        prepare: false,
        max: serverEnv().DATABASE_POOL_MAX,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      }),
    );
  }
  return db;
}

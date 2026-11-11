import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";

import { serverEnv } from "@/server/env";

import { postgresSsl } from "./ssl";
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

/** Cloudflare Hyperdrive binding (wrangler.jsonc "hyperdrive"). Only its connection string is used. */
interface HyperdriveBinding {
  connectionString: string;
}

declare global {
  interface CloudflareEnv {
    HYPERDRIVE?: HyperdriveBinding;
  }
}

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * Postgres for server code. Returns null when no usable connection is
 * configured; callers then answer 503 "storage_not_configured" (or, for
 * public pricing, fall back to the config file) instead of hanging.
 *
 * - Cloudflare Workers: through the HYPERDRIVE binding, with a new client per
 *   request. Workers can't share a socket between requests (a request that
 *   touches another request's socket hangs until the runtime cancels it), and
 *   they can't verify Supabase's certificate, which is signed by Supabase's
 *   own root CA. Hyperdrive holds the verified TLS connection to Supabase and
 *   pools it; the Worker only talks to Hyperdrive. DATABASE_URL is never used
 *   directly on Workers, since that would mean turning verification off.
 * - Node (local dev, scripts, tests): DATABASE_URL, one shared pool.
 */
export function database(): Db | null {
  return onWorkers ? workersDatabase() : nodeDatabase();
}

// ---------------------------------------------------------------- Workers

const perRequest = new WeakMap<object, Db>();
let warnedNoHyperdrive = false;

function workersDatabase(): Db | null {
  let context: ReturnType<typeof getCloudflareContext>;
  try {
    context = getCloudflareContext();
  } catch {
    return null; // outside a request (module init): nothing may connect here anyway
  }
  const hyperdrive = context.env.HYPERDRIVE;
  if (!hyperdrive?.connectionString) {
    if (!warnedNoHyperdrive) {
      warnedNoHyperdrive = true;
      console.error(
        JSON.stringify({
          event: "database.not_configured",
          detail: "No HYPERDRIVE binding. Database features answer 503 until it is added (see docs/DEPLOYMENT.md, Cloudflare Workers).",
        }),
      );
    }
    return null;
  }
  // ctx is the request's ExecutionContext: one object per incoming request.
  const requestKey = context.ctx as object;
  const existing = perRequest.get(requestKey);
  if (existing) return existing;
  const db = wrap(
    postgres(hyperdrive.connectionString, {
      // Hyperdrive does the pooling; a few connections per request is plenty.
      max: 5,
      prepare: false,
      // Types are fixed for this schema; skipping the lookup saves a round trip per request.
      fetch_types: false,
      connect_timeout: 5,
      idle_timeout: 5,
    }),
  );
  perRequest.set(requestKey, db);
  return db;
}

// ------------------------------------------------------------------- Node

let nodeDb: Db | null = null;

function nodeDatabase(): Db | null {
  const env = serverEnv();
  const url = env.DATABASE_URL;
  if (!url) return null;
  if (!nodeDb) {
    nodeDb = wrap(
      postgres(url, {
        prepare: false,
        max: env.DATABASE_POOL_MAX,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: postgresSsl(url, env.DATABASE_SSL_CA),
      }),
    );
  }
  return nodeDb;
}

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";

import type { Db, SqlParam } from "@/server/db/sql";

const root = path.resolve(import.meta.dirname, "../..");

/** A fresh embedded Postgres with the Supabase stubs and every migration applied. */
export async function createTestDatabase(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite();
  await pg.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).sort()) await pg.exec(readFileSync(path.join(dir, file), "utf8"));
  return { pg, db: wrap(pg) };
}

/** The app's Db interface over any PGlite instance (e.g. one built migration by migration). */
export const asDb = (pg: PGlite): Db => wrap(pg);

function wrap(client: PGlite | Transaction): Db {
  return {
    async query<T>(text: string, params: SqlParam[] = []) {
      const res = await client.query<T>(text, params);
      return res.rows;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!("transaction" in client)) return fn(wrap(client));
      return (client as PGlite).transaction((tx) => fn(wrap(tx)));
    },
  };
}

/** Create a user through auth.users so the real sign-up triggers run. */
export async function createUser(pg: PGlite) {
  const userId = randomUUID();
  await pg.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
  const { rows } = await pg.query<{ shop_id: string }>("select shop_id from public.shop_members where user_id = $1", [userId]);
  return { userId, shopId: rows[0]!.shop_id };
}

/**
 * Insert an approved generated image (with its source photo and job) for a
 * shop, returning ids and the storage path. Mirrors what the generation flow
 * leaves behind after a user approves a result.
 */
export async function insertGeneratedImage(
  pg: PGlite,
  o: { shopId: string; userId: string; fileName?: string; review?: "approved" | "pending" | "discarded"; ext?: string },
) {
  const sourceId = randomUUID();
  await pg.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
       storage_path, mime_type, width, height, status)
     values ($1, $2, $3, $4, 'image/jpeg', 1000, $5, $6, 'image/jpeg', 1200, 1200, 'ready')`,
    [sourceId, o.shopId, o.userId, o.fileName ?? "photo.jpg", `${o.shopId}/${sourceId}/upload.jpg`, `${o.shopId}/${sourceId}/source.jpg`],
  );
  const jobRows = await pg.query<{ id: string }>(
    `insert into public.generation_jobs (shop_id, source_image_id, requested_by, preset_slug, preset_version, credit_cost, provider, model, status, idempotency_key)
     values ($1, $2, $3, 'white-studio', 1, 1, 'openai', 'gpt-image-2.5-sunburst', 'succeeded', $4) returning id`,
    [o.shopId, sourceId, o.userId, randomUUID()],
  );
  const jobId = jobRows.rows[0]!.id;
  const storagePath = `${o.shopId}/${jobId}/result.${o.ext ?? "png"}`;
  const g = await pg.query<{ id: string }>(
    `insert into public.generated_images (shop_id, job_id, storage_path, mime_type, width, height, bytes, review_status, reviewed_at)
     values ($1, $2, $3, 'image/png', 1024, 1024, 1000, $4, now()) returning id`,
    [o.shopId, jobId, storagePath, o.review ?? "approved"],
  );
  return { generatedImageId: g.rows[0]!.id, storagePath };
}

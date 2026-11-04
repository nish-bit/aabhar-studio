import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { vi } from "vitest";

import type { AdminDeps } from "@/server/admin/deps-types";
import type { Db } from "@/server/db/sql";

import { createUser } from "./pglite-db";

export async function makeAdmin(pg: PGlite, role: "admin" | "support") {
  const u = await createUser(pg);
  await pg.query("insert into public.platform_admins (user_id, role, granted_by) values ($1, $2, 'test')", [u.userId, role]);
  const { rows } = await pg.query<{ email: string }>("select email from auth.users where id = $1", [u.userId]);
  return { ...u, email: rows[0]!.email };
}

export function testAdminDeps(db: Db) {
  const bans: { userId: string; banned: boolean }[] = [];
  return {
    db,
    authAdmin: { setBanned: async (userId: string, banned: boolean) => void bans.push({ userId, banned }) },
    startJob: vi.fn<(jobId: string) => void>(),
    providerConfigured: true,
    provider: { id: "openai", model: "test-model" },
    billingMode: "test",
    revalidatePlans: vi.fn<() => void>(),
    bans,
  } satisfies AdminDeps & { bans: unknown };
}

export async function readySource(pg: PGlite, shopId: string, userId: string) {
  const id = randomUUID();
  await pg.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
       storage_path, mime_type, width, height, status)
     values ($1, $2, $3, 'private-ring.jpg', 'image/jpeg', 1000, $4, $5, 'image/jpeg', 1200, 1200, 'ready')`,
    [id, shopId, userId, `${shopId}/${id}/upload.jpg`, `${shopId}/${id}/source.jpg`],
  );
  return id;
}

/** A failed generation job (as the runner leaves it), refunded. */
export async function failedJob(pg: PGlite, o: { shopId: string; userId: string; errorCode: string; instructions?: string }) {
  const src = await readySource(pg, o.shopId, o.userId);
  const { rows } = await pg.query<{ r_job_id: string }>(
    `select r_job_id from public.create_generation_job($1, $2, $3, 'white-studio', 1, $4, 1, 'openai', 'test-model', $5, 5, 100)`,
    [o.userId, o.shopId, src, o.instructions ?? null, randomUUID()],
  );
  const jobId = rows[0]!.r_job_id;
  await pg.query(`select public.claim_generation_job($1, 60)`, [jobId]);
  await pg.query(`select public.fail_generation_job($1, $2, 'Provider timed out', true)`, [jobId, o.errorCode]);
  await pg.query(
    `insert into public.job_attempts (job_id, attempt_no, provider, model, outcome, error_code, latency_ms) values ($1, 1, 'openai', 'test-model', 'timeout', $2, 120000)`,
    [jobId, o.errorCode],
  );
  return { jobId, sourceId: src };
}

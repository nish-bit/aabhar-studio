import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { requireAdmin, type AdminContext } from "@/server/admin/guard";
import { retryJob } from "@/server/admin/jobs";
import type { Db } from "@/server/db/sql";

import { failedJob, makeAdmin, testAdminDeps } from "../support/admin-fixtures";
import { createTestDatabase, createUser } from "../support/pglite-db";

/** Migration 20261103000100: generation_jobs.photo_size / jewellery_type. */
let pg: PGlite;
let db: Db;
let admin: AdminContext;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  const a = await makeAdmin(pg, "admin");
  admin = await requireAdmin(db, { id: a.userId, email: a.email }, "write");
}, 60_000);

describe("generation options columns", () => {
  it("accept only the known photo sizes and jewellery types; existing jobs default to null", async () => {
    const u = await createUser(pg);
    const { jobId } = await failedJob(pg, { ...u, errorCode: "timeout" });
    const { rows } = await pg.query<{ photo_size: string | null; jewellery_type: string | null }>(
      "select photo_size, jewellery_type from public.generation_jobs where id = $1",
      [jobId],
    );
    expect(rows[0]).toEqual({ photo_size: null, jewellery_type: null });
    await pg.query("update public.generation_jobs set photo_size = '9:16', jewellery_type = 'maang_teeka' where id = $1", [jobId]);
    await expect(pg.query("update public.generation_jobs set photo_size = '4:5' where id = $1", [jobId])).rejects.toThrow(/check/i);
    await expect(pg.query("update public.generation_jobs set jewellery_type = 'tiara' where id = $1", [jobId])).rejects.toThrow(/check/i);
  });

  it("an admin retry keeps the original job's photo size and jewellery type", async () => {
    const u = await createUser(pg);
    const { jobId } = await failedJob(pg, { ...u, errorCode: "timeout" });
    await pg.query("update public.generation_jobs set photo_size = '16:9', jewellery_type = 'bangles' where id = $1", [jobId]);
    const r = await retryJob(testAdminDeps(db), admin, { jobId, reason: "Provider outage, retrying" });
    const { rows } = await pg.query<{ photo_size: string; jewellery_type: string }>(
      "select photo_size, jewellery_type from public.generation_jobs where id = $1",
      [r.jobId],
    );
    expect(rows[0]).toEqual({ photo_size: "16:9", jewellery_type: "bangles" });
  });
});

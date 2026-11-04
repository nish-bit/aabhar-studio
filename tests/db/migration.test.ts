import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real SQL migration in an embedded Postgres and checks the money
 * and job functions directly: atomic debit, idempotent replay, guarded
 * transitions, refund-at-most-once, append-only ledger and RLS isolation.
 */
let db: PGlite;

const root = path.resolve(__dirname, "../..");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
}, 60_000);

async function newUser() {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  const { rows } = await db.query<{ shop_id: string }>("select shop_id from public.shop_members where user_id = $1", [id]);
  return { userId: id, shopId: rows[0]!.shop_id };
}

async function readySource(shopId: string, userId: string) {
  const id = randomUUID();
  await db.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
       storage_path, mime_type, width, height, status)
     values ($1, $2, $3, 'ring.jpg', 'image/jpeg', 1000, $4, $5, 'image/jpeg', 1200, 1200, 'ready')`,
    [id, shopId, userId, `${shopId}/${id}/upload.jpg`, `${shopId}/${id}/source.jpg`],
  );
  return id;
}

interface CreateResult {
  r_job_id: string;
  r_replayed: boolean;
  r_balance: number;
}

function createJob(o: { userId: string; shopId: string; sourceId: string; cost?: number; key?: string; maxActive?: number }) {
  return db.query<CreateResult>(
    `select * from public.create_generation_job($1, $2, $3, 'white-studio', 1, null, $4, 'openai', 'gpt-image-2.5-sunburst', $5, $6, 200)`,
    [o.userId, o.shopId, o.sourceId, o.cost ?? 1, o.key ?? randomUUID(), o.maxActive ?? 3],
  );
}

async function balance(shopId: string) {
  const { rows } = await db.query<{ balance: number }>("select balance from public.credit_balances where shop_id = $1", [shopId]);
  return rows[0]!.balance;
}

async function ledgerSum(shopId: string) {
  const { rows } = await db.query<{ s: number }>("select coalesce(sum(amount), 0)::int as s from public.credit_ledger where shop_id = $1", [shopId]);
  return rows[0]!.s;
}

describe("generation migration (real SQL)", () => {
  it("gives every new user a shop, owner membership and 2 trial credits", async () => {
    const { shopId } = await newUser();
    expect(await balance(shopId)).toBe(2);
    expect(await ledgerSum(shopId)).toBe(2);
  });

  it("debits atomically and replays an idempotency key without charging again", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    const key = randomUUID();
    const a = (await createJob({ userId, shopId, sourceId, cost: 2, key })).rows[0]!;
    const b = (await createJob({ userId, shopId, sourceId, cost: 2, key })).rows[0]!;
    expect(a.r_replayed).toBe(false);
    expect(a.r_balance).toBe(0);
    expect(b.r_job_id).toBe(a.r_job_id);
    expect(b.r_replayed).toBe(true);
    expect(await balance(shopId)).toBe(0);
    expect(await ledgerSum(shopId)).toBe(0);
  });

  it("rejects insufficient credits, other shops' photos and viewers", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    await expect(createJob({ userId, shopId, sourceId, cost: 3 })).rejects.toThrow(/insufficient_credits:2/);

    const other = await newUser();
    await expect(createJob({ userId: other.userId, shopId: other.shopId, sourceId })).rejects.toThrow(/source_not_found/);

    const viewer = randomUUID();
    await db.query("insert into auth.users (id) values ($1)", [viewer]);
    await db.query("insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'viewer')", [shopId, viewer]);
    await expect(createJob({ userId: viewer, shopId, sourceId })).rejects.toThrow(/forbidden/);
    expect(await balance(shopId)).toBe(2);
  });

  it("enforces the concurrent jobs limit", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    await createJob({ userId, shopId, sourceId, maxActive: 2 });
    await createJob({ userId, shopId, sourceId, maxActive: 2 });
    await expect(createJob({ userId, shopId, sourceId, maxActive: 2 })).rejects.toThrow(/too_many_active_jobs/);
  });

  it("claims once, completes once, and refuses late transitions", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    const jobId = (await createJob({ userId, shopId, sourceId })).rows[0]!.r_job_id;

    expect((await db.query("select * from public.claim_generation_job($1, 295)", [jobId])).rows).toHaveLength(1);
    expect((await db.query("select * from public.claim_generation_job($1, 295)", [jobId])).rows).toHaveLength(0);

    const complete = () =>
      db.query<{ ok: boolean }>(
        `select public.complete_generation_job($1, $2, 'image/png', 1024, 1024, 5000, '{"total_tokens": 5350}'::jsonb, 129750, 'req_1') as ok`,
        [jobId, `${shopId}/${jobId}/result.png`],
      );
    expect((await complete()).rows[0]!.ok).toBe(true);
    expect((await complete()).rows[0]!.ok).toBe(false);

    const fail = await db.query<{ ok: boolean }>("select public.fail_generation_job($1, 'x', 'y', true) as ok", [jobId]);
    expect(fail.rows[0]!.ok).toBe(false);
    expect(await balance(shopId)).toBe(1); // succeeded jobs keep their charge
  });

  it("refunds a failed job exactly once", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    const jobId = (await createJob({ userId, shopId, sourceId, cost: 2 })).rows[0]!.r_job_id;
    await db.query("select * from public.claim_generation_job($1, 295)", [jobId]);

    await db.query("select public.fail_generation_job($1, 'retryable', 'busy', true)", [jobId]);
    await db.query("select public.fail_generation_job($1, 'retryable', 'busy', true)", [jobId]);
    expect(await balance(shopId)).toBe(2);
    expect(await ledgerSum(shopId)).toBe(2);
    const { rows } = await db.query<{ refunded: boolean }>("select refunded from public.generation_jobs where id = $1", [jobId]);
    expect(rows[0]!.refunded).toBe(true);
  });

  it("expires stale processing jobs and refunds them", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    const jobId = (await createJob({ userId, shopId, sourceId })).rows[0]!.r_job_id;
    await db.query("select * from public.claim_generation_job($1, 295)", [jobId]);
    await db.query("update public.generation_jobs set locked_until = now() - interval '1 minute' where id = $1", [jobId]);

    const { rows } = await db.query<{ n: number }>("select public.expire_stale_generation_jobs() as n");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
    expect(await balance(shopId)).toBe(2);
  });

  it("keeps the ledger append-only", async () => {
    const { shopId } = await newUser();
    await expect(db.query("update public.credit_ledger set amount = 999 where shop_id = $1", [shopId])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.credit_ledger where shop_id = $1", [shopId])).rejects.toThrow(/append-only/);
  });

  it("blocks authenticated users from calling the money functions directly", async () => {
    const { userId, shopId } = await newUser();
    const sourceId = await readySource(shopId, userId);
    await db.exec("set role authenticated");
    try {
      await expect(createJob({ userId, shopId, sourceId })).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("lets members read only their own shop's jobs (RLS)", async () => {
    const a = await newUser();
    const b = await newUser();
    const sourceId = await readySource(a.shopId, a.userId);
    await createJob({ userId: a.userId, shopId: a.shopId, sourceId });

    await db.exec("grant usage on schema public to authenticated; grant select on all tables in schema public to authenticated;");
    const countAs = async (userId: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
      try {
        const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.generation_jobs");
        return rows[0]!.n;
      } finally {
        await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
      }
    };
    expect(await countAs(a.userId)).toBe(1);
    expect(await countAs(b.userId)).toBe(0);
  });
});

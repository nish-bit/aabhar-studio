import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { billingConfig, FREE_TRIAL_LIMIT, planById } from "@/config/billing";
import { PRESETS } from "@/lib/presets";
import { BillingRepository } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";

import { failedJob, readySource } from "../support/admin-fixtures";
import { asDb, createTestDatabase, createUser } from "../support/pglite-db";

/**
 * The free trial: exactly FREE_TRIAL_LIMIT (2) credits, granted once by the
 * sign-up trigger, and enough for exactly that many images on the trial's
 * styles. The ledger enforces it on the server.
 * Also proves the migration that set it leaves existing users alone.
 */
const MIGRATION = "20261103000500_trial_credits_2.sql";
const T = FREE_TRIAL_LIMIT;
const root = path.resolve(import.meta.dirname, "../..");

let pg: PGlite;
let db: Db;

const balance = async (shopId: string) =>
  (await pg.query<{ b: number }>("select balance as b from public.credit_balances where shop_id = $1", [shopId])).rows[0]!.b;
const trialGrants = async (shopId: string) =>
  (await pg.query<{ amount: number }>("select amount from public.credit_grants where shop_id = $1 and source = 'trial'", [shopId])).rows;
const job = (u: { userId: string; shopId: string }, src: string) =>
  pg.query(`select * from public.create_generation_job($1, $2, $3, 'white-studio', 1, null, 1, 'openai', 'test-model', $4, 5, 100)`, [
    u.userId,
    u.shopId,
    src,
    randomUUID(),
  ]);

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

describe("free sign-up allowance", () => {
  it("is 2 in the config and in the database setting", async () => {
    expect(FREE_TRIAL_LIMIT).toBe(2);
    expect(billingConfig.trial.credits).toBe(2);
    const { rows } = await pg.query<{ c: number }>("select trial_credits as c from public.billing_settings where id");
    expect(rows[0]!.c).toBe(T);
  });

  it("gives a new user exactly 2 credits, as one trial grant", async () => {
    const u = await createUser(pg);
    expect(await balance(u.shopId)).toBe(T);
    expect(await trialGrants(u.shopId)).toEqual([{ amount: T }]);
  });

  it("never grants again on later sign-ins (Supabase updates the same auth.users row)", async () => {
    const u = await createUser(pg);
    await pg.query("update auth.users set email = $2 where id = $1", [u.userId, `again-${u.userId}@test.local`]);
    await pg.query("update auth.users set email = email where id = $1", [u.userId]);
    expect(await trialGrants(u.shopId)).toHaveLength(1);
    expect(await balance(u.shopId)).toBe(T);
  });

  it("can't be granted twice for the same shop, even if the grant is replayed", async () => {
    const u = await createUser(pg);
    const { rows } = await pg.query<{ id: string | null }>(
      `select public.grant_credits($1, 2, 'trial', now() + interval '30 days', $2, 'Free trial') as id`,
      [u.shopId, `grant:trial:${u.shopId}`],
    );
    expect(rows[0]!.id).toBeNull();
    expect(await balance(u.shopId)).toBe(T);
  });

  it("covers exactly 2 images on the trial's styles, then refuses a 3rd until more credits are added", async () => {
    const trialStyles = planById("trial")!.limits.presets;
    expect(trialStyles).not.toBe("all");
    for (const slug of trialStyles as readonly (keyof typeof PRESETS)[]) expect(PRESETS[slug].creditCost).toBe(1);

    const u = await createUser(pg);
    const src = await readySource(pg, u.shopId, u.userId);
    for (let i = 0; i < T; i++) await job(u, src);
    expect(await balance(u.shopId)).toBe(0);
    await expect(job(u, src)).rejects.toThrow(/insufficient_credits/);
    expect(await balance(u.shopId)).toBe(0); // the refused attempt charged nothing

    await pg.query(`select public.grant_credits($1, 50, 'pack', now() + interval '1 year', $2, 'Credit pack')`, [u.shopId, `test:${randomUUID()}`]);
    await job(u, src);
    expect(await balance(u.shopId)).toBe(49);
  });

  it("reports the free trial for the 'Free Trial: X / 2' line: 2 → 1 → 0, a failed image doesn't count, expiry reads as 0", async () => {
    const u = await createUser(pg);
    const repo = new BillingRepository(db);
    const src = await readySource(pg, u.shopId, u.userId);
    expect(await repo.freeTrial(u.shopId)).toMatchObject({ total: T, remaining: T, expired: false });
    await job(u, src);
    expect((await repo.freeTrial(u.shopId))!.remaining).toBe(T - 1);
    const { rows } = await job(u, src);
    expect((await repo.freeTrial(u.shopId))!.remaining).toBe(0);
    const failed = (rows[0] as { r_job_id: string }).r_job_id;
    await pg.query(`select public.claim_generation_job($1, 60)`, [failed]);
    await pg.query(`select public.fail_generation_job($1, 'timeout', 'Provider timed out', true)`, [failed]);
    expect((await repo.freeTrial(u.shopId))!.remaining).toBe(1);
    await pg.query("update public.credit_grants set expires_at = now() - interval '1 minute' where shop_id = $1 and source = 'trial'", [u.shopId]);
    expect(await repo.freeTrial(u.shopId)).toMatchObject({ remaining: 0, expired: true });
  });

  it("returns the credit when a generation fails", async () => {
    const u = await createUser(pg);
    const src = await readySource(pg, u.shopId, u.userId);
    const { rows } = await job(u, src);
    const jobId = (rows[0] as { r_job_id: string }).r_job_id;
    expect(await balance(u.shopId)).toBe(T - 1);
    await pg.query(`select public.claim_generation_job($1, 60)`, [jobId]);
    await pg.query(`select public.fail_generation_job($1, 'timeout', 'Provider timed out', true)`, [jobId]);
    expect(await balance(u.shopId)).toBe(T);
  });
});

describe(`migration ${MIGRATION}`, () => {
  it("changes only the allowance for future sign-ups; existing balances, grants and ledger stay as they were", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    const files = readdirSync(dir).sort();
    expect(files).toContain(MIGRATION);
    for (const f of files.filter((f) => f < MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));

    // An existing user from before the change, with trial credits, a pack, and some spending.
    const oldUser = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'old@test.local')", [oldUser]);
    const shop = (await db.query<{ s: string }>("select shop_id as s from public.shop_members where user_id = $1", [oldUser])).rows[0]!.s;
    await db.query(`select public.grant_credits($1, 50, 'pack', now() + interval '1 year', 'test:old-pack', 'Credit pack')`, [shop]);
    const snapshot = async () => ({
      balance: (await db.query<{ b: number }>("select balance as b from public.credit_balances where shop_id = $1", [shop])).rows[0]!.b,
      grants: (await db.query("select id, source, amount, remaining, expires_at from public.credit_grants where shop_id = $1 order by id", [shop])).rows,
      ledger: (await db.query("select id, entry_type, amount, balance_after from public.credit_ledger where shop_id = $1 order by id", [shop])).rows,
    });
    const before = await snapshot();
    expect(before.balance).toBe(53); // 3 trial (the allowance before this migration) + 50 pack

    await db.exec(readFileSync(path.join(dir, MIGRATION), "utf8"));

    expect(await snapshot()).toEqual(before);
    const newUser = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'new@test.local')", [newUser]);
    const newShop = (await db.query<{ s: string }>("select shop_id as s from public.shop_members where user_id = $1", [newUser])).rows[0]!.s;
    expect((await db.query<{ b: number }>("select balance as b from public.credit_balances where shop_id = $1", [newShop])).rows[0]!.b).toBe(T);
    await db.close();
  }, 60_000);

  it("sets 2 even when an admin had chosen a different trial", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    const files = readdirSync(dir).sort();
    for (const f of files.filter((f) => f < MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.query("update public.billing_settings set trial_credits = 25");
    for (const f of files.filter((f) => f >= MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    expect((await db.query<{ c: number }>("select trial_credits as c from public.billing_settings")).rows[0]!.c).toBe(T);
    await db.close();
  }, 60_000);
});

const CAP_MIGRATION = "20261104000100_trial_cap_existing.sql";

describe(`migration ${CAP_MIGRATION}`, () => {
  it("limits existing accounts to 2 free generations in total, counting what they already used, and leaves everything else alone", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    const files = readdirSync(dir).sort();
    expect(files).toContain(CAP_MIGRATION);
    for (const f of files.filter((f) => f < CAP_MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));

    // Accounts that signed up under the old 10-credit trial (and one under the 3-credit trial).
    const signUp = async (trial: number) => {
      await db.query("update public.billing_settings set trial_credits = $1", [trial]);
      const userId = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${userId}@test.local`]);
      const shopId = (await db.query<{ s: string }>("select shop_id as s from public.shop_members where user_id = $1", [userId])).rows[0]!.s;
      return { userId, shopId };
    };
    const generate = async (u: { userId: string; shopId: string }, n: number) => {
      const src = await readySource(db, u.shopId, u.userId);
      for (let i = 0; i < n; i++) {
        await db.query(`select * from public.create_generation_job($1, $2, $3, 'white-studio', 1, null, 1, 'openai', 'test-model', $4, 5, 100)`, [
          u.userId,
          u.shopId,
          src,
          randomUUID(),
        ]);
      }
    };
    const trialLeft = async (shopId: string) =>
      (await db.query<{ r: number }>("select remaining as r from public.credit_grants where shop_id = $1 and source = 'trial'", [shopId])).rows[0]!.r;
    const balanceOf = async (shopId: string) =>
      (await db.query<{ b: number }>("select balance as b from public.credit_balances where shop_id = $1", [shopId])).rows[0]!.b;

    const used0 = await signUp(10);
    const used1 = await signUp(10);
    const used2 = await signUp(10);
    const used5 = await signUp(10);
    const small = await signUp(3);
    await generate(used1, 1);
    await generate(used2, 2);
    await generate(used5, 5);
    // A buyer: their purchased credits must not change.
    const buyer = await signUp(10);
    await generate(buyer, 1);
    await db.query(`select public.grant_credits($1, 20, 'pack', now() + interval '1 year', 'test:buyer-pack', 'Credit pack')`, [buyer.shopId]);
    // A failed generation is refunded, so it doesn't count as used.
    const failed = await signUp(10);
    await failedJob(db, { ...failed, errorCode: "timeout" });

    await db.query("update public.billing_settings set trial_credits = 2"); // as migration 20261103000500 left it
    const jobsBefore = (await db.query("select id, status from public.generation_jobs order by id")).rows;
    const packBefore = (await db.query("select id, remaining from public.credit_grants where source = 'pack'")).rows;

    await db.exec(readFileSync(path.join(dir, CAP_MIGRATION), "utf8"));

    expect(await trialLeft(used0.shopId)).toBe(2);
    expect(await trialLeft(used1.shopId)).toBe(1);
    expect(await trialLeft(used2.shopId)).toBe(0);
    expect(await trialLeft(used5.shopId)).toBe(0);
    expect(await trialLeft(small.shopId)).toBe(2);
    expect(await trialLeft(failed.shopId)).toBe(2);
    expect(await trialLeft(buyer.shopId)).toBe(1);
    expect(await balanceOf(buyer.shopId)).toBe(21); // 1 free left + 20 purchased
    expect((await db.query("select id, remaining from public.credit_grants where source = 'pack'")).rows).toEqual(packBefore);
    expect((await db.query("select id, status from public.generation_jobs order by id")).rows).toEqual(jobsBefore);

    // Balances still equal the sum of live grants, and the ledger records the change.
    const drift = await db.query(
      `select b.shop_id from public.credit_balances b
        where b.balance <> (select coalesce(sum(g.remaining), 0) from public.credit_grants g
                             where g.shop_id = b.shop_id and (g.expires_at is null or g.expires_at > now()))`,
    );
    expect(drift.rows).toEqual([]);
    const adj = await db.query<{ amount: number }>("select amount from public.credit_ledger where shop_id = $1 and entry_type = 'adjustment'", [used2.shopId]);
    expect(adj.rows).toEqual([{ amount: -8 }]); // 10-credit trial, 2 used: the other 8 removed

    // Running it again changes nothing, and the status line reads "x / 2".
    const ledgerRows = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.credit_ledger")).rows[0]!.n;
    const n = await ledgerRows();
    await db.exec(readFileSync(path.join(dir, CAP_MIGRATION), "utf8"));
    expect(await ledgerRows()).toBe(n);
    expect(await trialLeft(used1.shopId)).toBe(1);
    const repo = new BillingRepository(asDb(db));
    expect(await repo.freeTrial(used1.shopId)).toMatchObject({ total: 2, remaining: 1 });
    expect(await repo.freeTrial(used5.shopId)).toMatchObject({ total: 2, remaining: 0 });

    // After the cap: one more free image for used1, then credits are required.
    await generate(used1, 1);
    await expect(generate(used1, 1)).rejects.toThrow(/insufficient_credits/);
    await db.close();
  }, 120_000);
});

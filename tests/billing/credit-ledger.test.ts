import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * The credit-lot SQL: trial grant at sign-up, spend-soonest-expiring-first,
 * exact refunds back to the original lot, expiry, idempotent grants, and
 * that signed-in users can't touch balances or call the money functions.
 */
let pg: PGlite;

beforeAll(async () => {
  ({ pg } = await createTestDatabase());
}, 60_000);

async function readySource(shopId: string, userId: string) {
  const id = randomUUID();
  await pg.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
       storage_path, mime_type, width, height, status)
     values ($1, $2, $3, 'ring.jpg', 'image/jpeg', 1000, $4, $5, 'image/jpeg', 1200, 1200, 'ready')`,
    [id, shopId, userId, `${shopId}/${id}/up.jpg`, `${shopId}/${id}/src.jpg`],
  );
  return id;
}

const job = (u: { userId: string; shopId: string }, sourceId: string, cost = 1) =>
  pg.query<{ r_job_id: string; r_balance: number }>(
    `select * from public.create_generation_job($1, $2, $3, 'white-studio', 1, null, $4, 'openai', 'm', $5, 10, 1000)`,
    [u.userId, u.shopId, sourceId, cost, randomUUID()],
  );

const grant = (shopId: string, amount: number, source: string, expires: string | null, key: string = randomUUID()) =>
  pg.query<{ id: string | null }>(`select public.grant_credits($1, $2, $3, $4::timestamptz, $5, 'test') as id`, [shopId, amount, source, expires, key]);

async function state(shopId: string) {
  const b = await pg.query<{ balance: number }>("select balance from public.credit_balances where shop_id = $1", [shopId]);
  const l = await pg.query<{ s: number }>("select coalesce(sum(amount),0)::int as s from public.credit_ledger where shop_id = $1", [shopId]);
  const g = await pg.query<{ s: number }>("select coalesce(sum(remaining),0)::int as s from public.credit_grants where shop_id = $1", [shopId]);
  return { balance: b.rows[0]!.balance, ledger: l.rows[0]!.s, grants: g.rows[0]!.s };
}

describe("credit grants", () => {
  it("gives new shops the configured trial allowance as an expiring grant", async () => {
    await pg.query("update public.billing_settings set trial_credits = 4, trial_validity_days = 14");
    const u = await createUser(pg);
    const { rows } = await pg.query<{ amount: number; days: number }>(
      "select amount, round(extract(epoch from expires_at - now()) / 86400)::int as days from public.credit_grants where shop_id = $1 and source = 'trial'",
      [u.shopId],
    );
    expect(rows[0]).toEqual({ amount: 4, days: 14 });
    expect(await state(u.shopId)).toEqual({ balance: 4, ledger: 4, grants: 4 });
    await pg.query("update public.billing_settings set trial_credits = 10, trial_validity_days = 30");
  });

  it("grants once per idempotency key", async () => {
    const u = await createUser(pg);
    const key = `grant:test:${randomUUID()}`;
    expect((await grant(u.shopId, 50, "pack", null, key)).rows[0]!.id).not.toBeNull();
    expect((await grant(u.shopId, 50, "pack", null, key)).rows[0]!.id).toBeNull();
    expect((await state(u.shopId)).balance).toBe(60);
  });

  it("spends the soonest-expiring credits first and refunds them to the same lot", async () => {
    const u = await createUser(pg); // 10 trial credits, 30 days
    await grant(u.shopId, 5, "plan", new Date(Date.now() + 3 * 86_400_000).toISOString());
    await grant(u.shopId, 20, "pack", new Date(Date.now() + 365 * 86_400_000).toISOString());
    const src = await readySource(u.shopId, u.userId);

    const j = (await job(u, src, 7)).rows[0]!;
    const alloc = await pg.query<{ source: string; amount: number }>(
      `select g.source, a.amount from public.credit_allocations a join public.credit_grants g on g.id = a.grant_id where a.job_id = $1 order by g.expires_at`,
      [j.r_job_id],
    );
    expect(alloc.rows).toEqual([
      { source: "plan", amount: 5 },
      { source: "trial", amount: 2 },
    ]);
    expect(await state(u.shopId)).toEqual({ balance: 28, ledger: 28, grants: 28 });

    await pg.query(`select public.fail_generation_job($1, 'x', 'x', true)`, [j.r_job_id]);
    await pg.query(`select public.fail_generation_job($1, 'x', 'x', true)`, [j.r_job_id]); // second call is a no-op
    const lots = await pg.query<{ source: string; remaining: number }>(
      "select source, remaining from public.credit_grants where shop_id = $1 order by expires_at",
      [u.shopId],
    );
    expect(lots.rows).toEqual([
      { source: "plan", remaining: 5 },
      { source: "trial", remaining: 10 },
      { source: "pack", remaining: 20 },
    ]);
    expect(await state(u.shopId)).toEqual({ balance: 35, ledger: 35, grants: 35 });
  });

  it("returns refunds as a fresh 30-day lot when the original lot has expired", async () => {
    const u = await createUser(pg);
    const src = await readySource(u.shopId, u.userId);
    const j = (await job(u, src, 2)).rows[0]!;
    await pg.query("update public.credit_grants set expires_at = now() - interval '1 minute' where shop_id = $1 and source = 'trial'", [u.shopId]);
    await pg.query(`select public.fail_generation_job($1, 'x', 'x', true)`, [j.r_job_id]);
    const { rows } = await pg.query<{ amount: number; days: number }>(
      "select amount, round(extract(epoch from expires_at - now()) / 86400)::int as days from public.credit_grants where shop_id = $1 and source = 'refund_restore'",
      [u.shopId],
    );
    expect(rows[0]).toEqual({ amount: 2, days: 30 });
  });

  it("expires lapsed credits into the ledger and refuses spending them", async () => {
    const u = await createUser(pg);
    await pg.query("update public.credit_grants set expires_at = now() - interval '1 second' where shop_id = $1", [u.shopId]);
    const src = await readySource(u.shopId, u.userId);
    await expect(job(u, src, 1)).rejects.toThrow(/insufficient_credits:0/); // expired at spend time, even before the cron runs
    expect((await pg.query<{ n: number }>("select public.expire_credit_grants() as n")).rows[0]!.n).toBeGreaterThanOrEqual(1);
    const { rows } = await pg.query<{ entry_type: string; amount: number; balance_after: number }>(
      "select entry_type::text, amount, balance_after from public.credit_ledger where shop_id = $1 order by id desc limit 1",
      [u.shopId],
    );
    expect(rows[0]).toEqual({ entry_type: "expiry", amount: -10, balance_after: 0 });
    expect((await pg.query<{ n: number }>("select public.expire_credit_grants() as n")).rows[0]!.n).toBe(0); // idempotent
    expect(await state(u.shopId)).toEqual({ balance: 0, ledger: 0, grants: 0 });
  });

  it("takes back refunded credits only from what's left in the lot", async () => {
    const u = await createUser(pg);
    const g = (await grant(u.shopId, 100, "pack", null)).rows[0]!.id!;
    await pg.query("update public.credit_grants set remaining = 30 where id = $1", [g]);
    await pg.query("update public.credit_balances set balance = balance - 70 where shop_id = $1", [u.shopId]);
    const r = await pg.query<{ r_reversed: number; r_shortfall: number }>("select * from public.reverse_grant($1, 100, 'refund:t1', 'Refund')", [g]);
    expect(r.rows[0]).toEqual({ r_reversed: 30, r_shortfall: 70 });
    const again = await pg.query<{ r_reversed: number }>("select * from public.reverse_grant($1, 100, 'refund:t1', 'Refund')", [g]);
    expect(again.rows[0]!.r_reversed).toBe(0);
    expect((await state(u.shopId)).balance).toBe(10);
  });
});

describe("client access", () => {
  async function asUser<T>(userId: string, fn: () => Promise<T>) {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    try {
      return await fn();
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  }

  it("never lets a signed-in user change their own balance, grants or billing records", async () => {
    const u = await createUser(pg);
    await asUser(u.userId, async () => {
      await expect(pg.query("update public.credit_balances set balance = 99999 where shop_id = $1", [u.shopId])).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.credit_grants set remaining = 99999 where shop_id = $1", [u.shopId])).rejects.toThrow(/permission denied/);
      await expect(
        pg.query("insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, idempotency_key) values ($1, 'grant', 500, 500, 'x')", [u.shopId]),
      ).rejects.toThrow(/permission denied/);
      await expect(pg.query("select public.grant_credits($1, 500, 'admin', null, 'hack', 'hack')", [u.shopId])).rejects.toThrow(/permission denied/);
      await expect(pg.query("select public.reverse_grant(gen_random_uuid(), 1, 'k', 'r')")).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.billing_subscriptions set status = 'active'")).rejects.toThrow(/permission denied/);
      await expect(pg.query("insert into public.billing_payments (shop_id) values ($1)", [u.shopId])).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from public.billing_webhook_events")).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.billing_settings set trial_credits = 1000")).rejects.toThrow(/permission denied/);
      // Reading their own grants is allowed.
      const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.credit_grants");
      expect(rows[0]!.n).toBe(1);
    });
    expect((await state(u.shopId)).balance).toBe(10);
  });

  it("shows members only their own shop's billing rows", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    await grant(a.shopId, 5, "admin", null);
    const count = await asUser(b.userId, async () => (await pg.query<{ n: number }>("select count(*)::int as n from public.credit_grants")).rows[0]!.n);
    expect(count).toBe(1); // b's own trial grant only
  });
});

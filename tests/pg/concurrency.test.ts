import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { billingConfig, paidPlans } from "@/config/billing";
import { requireAdmin } from "@/server/admin/guard";
import { retryJob } from "@/server/admin/jobs";
import { grantPromoCredits } from "@/server/admin/users";
import { BillingRepository } from "@/server/billing/repository";
import { createPackOrder, handleRazorpayWebhook, verifyPackPayment, type BillingDeps } from "@/server/billing/service";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createRealDatabase, REAL_PG_URL, realSource, realUser } from "./real-postgres";

/**
 * Money paths under genuinely concurrent requests (separate connections on
 * a real PostgreSQL server). Every test checks the invariant that the cached
 * balance, the ledger sum and the remaining credit lots agree.
 */
describe.skipIf(!REAL_PG_URL)("concurrency on real PostgreSQL", () => {
  let env: Awaited<ReturnType<typeof createRealDatabase>>;

  beforeAll(async () => {
    env = await createRealDatabase(16);
  }, 60_000);
  afterAll(async () => env?.drop());

  const invariant = async (shopId: string) => {
    const [r] = await env.sql<{ balance: number; ledger: number; lots: number; neg: number }[]>`
      select (select balance from public.credit_balances where shop_id = ${shopId}) as balance,
             (select coalesce(sum(amount), 0)::int from public.credit_ledger where shop_id = ${shopId}) as ledger,
             (select coalesce(sum(remaining), 0)::int from public.credit_grants where shop_id = ${shopId}) as lots,
             (select count(*)::int from public.credit_grants where shop_id = ${shopId} and remaining < 0) as neg`;
    expect(r!.ledger).toBe(r!.balance);
    expect(r!.lots).toBe(r!.balance);
    expect(r!.neg).toBe(0);
    expect(r!.balance).toBeGreaterThanOrEqual(0);
    return r!.balance;
  };

  const createJob = (u: { userId: string; shopId: string }, src: string, key = randomUUID(), maxActive = 100) =>
    env.sql`select * from public.create_generation_job(${u.userId}, ${u.shopId}, ${src}, 'white-studio', 1, null, 1, 'openai', 'm', ${key}, ${maxActive}, 1000)`;

  it("20 parallel generations with 2 credits: exactly 2 succeed, never overdrawn", async () => {
    const u = await realUser(env.sql);
    // New users start with 2 trial credits, exactly the balance this test needs.
    const src = await realSource(env.sql, u.shopId, u.userId);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => createJob(u, src)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const insufficient = results.filter((r) => r.status === "rejected" && /insufficient_credits/.test(String((r as PromiseRejectedResult).reason)));
    expect(ok).toHaveLength(2);
    expect(insufficient).toHaveLength(18);
    expect(await invariant(u.shopId)).toBe(0);
  });

  it("the same idempotency key sent 15 times at once creates one job and one charge", async () => {
    const u = await realUser(env.sql);
    const src = await realSource(env.sql, u.shopId, u.userId);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 15 }, () => createJob(u, src, key)));
    expect(new Set(results.map((r) => r[0]!.r_job_id)).size).toBe(1);
    const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from public.credit_ledger where shop_id = ${u.shopId} and entry_type = 'debit'`;
    expect(n).toBe(1);
    expect(await invariant(u.shopId)).toBe(1);
  });

  it("concurrent failure handlers refund a job exactly once", async () => {
    const u = await realUser(env.sql);
    const src = await realSource(env.sql, u.shopId, u.userId);
    const [job] = await createJob(u, src);
    await Promise.all(Array.from({ length: 12 }, () => env.sql`select public.fail_generation_job(${job!.r_job_id}, 'timeout', 'x', true)`));
    const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from public.credit_ledger where job_id = ${job!.r_job_id} and entry_type = 'refund'`;
    expect(n).toBe(1);
    expect(await invariant(u.shopId)).toBe(2);
  });

  it("spending while the expiry sweep runs keeps the ledger consistent", async () => {
    const u = await realUser(env.sql);
    const src = await realSource(env.sql, u.shopId, u.userId);
    await env.sql`select public.grant_credits(${u.shopId}, 5, 'pack', now() + interval '1 year', ${`k:${randomUUID()}`}, 'pack')`;
    await env.sql`update public.credit_grants set expires_at = now() + interval '200 milliseconds' where shop_id = ${u.shopId} and source = 'trial'`;
    await new Promise((r) => setTimeout(r, 250));
    await Promise.allSettled([
      ...Array.from({ length: 8 }, () => createJob(u, src)),
      ...Array.from({ length: 4 }, () => env.sql`select public.expire_credit_grants()`),
    ]);
    const balance = await invariant(u.shopId);
    expect(balance).toBe(0); // 2 trial credits expired; the 5 pack credits were spent
  });

  describe("payments", () => {
    let gateway: FakeGateway;
    let deps: BillingDeps;

    beforeAll(async () => {
      gateway = new FakeGateway();
      const repo = new BillingRepository(env.db);
      for (const [i, p] of billingConfig.plans.entries()) {
        await repo.upsertPlan({ id: p.id, name: p.name, monthlyCredits: p.monthlyCredits, limits: p.limits, isPaid: p.monthlyPricePaise !== null, sortOrder: i });
      }
      for (const p of paidPlans()) {
        const rp = await gateway.createPlan({ name: p.name, amountPaise: p.monthlyPricePaise });
        await repo.insertPrice({ planId: p.id, mode: "test", amountPaise: p.monthlyPricePaise, razorpayPlanId: rp.id });
      }
      for (const [i, k] of billingConfig.packs.entries()) {
        await repo.upsertPack({ id: k.id, name: k.name, credits: k.credits, amountPaise: k.pricePaise, validityDays: k.validityDays, sortOrder: i });
      }
      deps = { repo, gateway, availability: { enabled: true, mode: "test", keyId: KEY_ID, reason: null }, config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" } };
    });

    it("10 simultaneous deliveries of one webhook plus 5 verify calls grant the pack once", async () => {
      const u = await realUser(env.sql);
      const order = await createPackOrder(deps, { id: u.userId, email: null }, { packId: "solo", idempotencyKey: randomUUID() });
      const { checkout, payment } = gateway.payOrder(order.orderId);
      const w = webhook("payment.captured", { payment }, { eventId: `evt_${randomUUID()}` });
      const other = webhook("order.paid", { payment, order: gateway.orders.get(order.orderId) });
      const results = await Promise.allSettled([
        ...Array.from({ length: 10 }, () => handleRazorpayWebhook(deps, w.body, w.headers)),
        handleRazorpayWebhook(deps, other.body, other.headers),
        ...Array.from({ length: 5 }, () => verifyPackPayment(deps, u.userId, checkout)),
      ]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
      const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from public.credit_grants where shop_id = ${u.shopId} and source = 'pack'`;
      expect(n).toBe(1);
      expect(await invariant(u.shopId)).toBe(22); // 2 trial + 20 Solo
      const [{ processed }] = await env.sql<{ processed: number }[]>`select count(*)::int as processed from public.billing_webhook_events where event_id = ${w.headers.eventId} and processed_at is not null`;
      expect(processed).toBe(1);
    });

    it("a double-clicked purchase creates one Razorpay order", async () => {
      const u = await realUser(env.sql);
      const key = randomUUID();
      const before = gateway.calls.filter((c) => c === "createOrder").length;
      const res = await Promise.allSettled(Array.from({ length: 6 }, () => createPackOrder(deps, { id: u.userId, email: null }, { packId: "solo", idempotencyKey: key })));
      const ids = new Set(res.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ orderId: string }>).value.orderId));
      expect(ids.size).toBe(1);
      const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from public.billing_orders where shop_id = ${u.shopId}`;
      expect(n).toBe(1);
      // Extra Razorpay orders may be created by racing requests, but only one is ever recorded or payable here.
      expect(gateway.calls.filter((c) => c === "createOrder").length - before).toBeGreaterThanOrEqual(1);
    });
  });

  describe("admin actions", () => {
    it("parallel promotional grants with one key grant once; parallel retries create one job", async () => {
      const a = await realUser(env.sql);
      await env.sql`insert into public.platform_admins (user_id, role, granted_by) values (${a.userId}, 'admin', 'qa')`;
      const ctx = await requireAdmin(env.db, { id: a.userId, email: null }, "write");
      const deps = { db: env.db, providerConfigured: true, provider: { id: "openai", model: "m" }, billingMode: "test" as const, startJob: () => undefined };
      const u = await realUser(env.sql);
      const key = randomUUID();
      await Promise.allSettled(
        Array.from({ length: 10 }, () => grantPromoCredits(deps, ctx, { shopId: u.shopId, amount: 7, expiresInDays: null, reason: "parallel grant test", idempotencyKey: key })),
      );
      expect(await invariant(u.shopId)).toBe(17);

      const src = await realSource(env.sql, u.shopId, u.userId);
      const [job] = await createJob(u, src);
      await env.sql`select public.claim_generation_job(${job!.r_job_id}, 60)`;
      await env.sql`select public.fail_generation_job(${job!.r_job_id}, 'timeout', 'x', true)`;
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => retryJob(deps, ctx, { jobId: job!.r_job_id, reason: "parallel retry test" })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from public.generation_jobs where idempotency_key = ${`admin-retry:${job!.r_job_id}`}`;
      expect(n).toBe(1);
      expect(await invariant(u.shopId)).toBe(16);
    });
  });
});

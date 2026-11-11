import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { billingConfig, paidPlans } from "@/config/billing";
import { GatewayError } from "@/server/billing/gateway";
import { BillingRepository } from "@/server/billing/repository";
import { createPackOrder, handleRazorpayWebhook, verifyPackPayment, type BillingDeps } from "@/server/billing/service";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createRealDatabase, REAL_PG_URL, realUser } from "./real-postgres";

/**
 * Razorpay settlement under genuinely concurrent requests: every call below
 * runs on its own connection of a real PostgreSQL server (TEST_DATABASE_URL,
 * a disposable superuser connection; never production). After each scenario
 * the database must satisfy:
 *   - every captured payment has exactly one pack credit grant;
 *   - failed / authorized / created payments have none;
 *   - an order is 'paid' exactly when it has a captured payment;
 *   - cached balance = ledger sum = remaining credit lots, none negative.
 */

const POOL = 32;

/** Razorpay-like capture: a second capture of the same payment is refused, as the real API does. */
class StrictGateway extends FakeGateway {
  override async capturePayment(paymentId: string, amountPaise: number) {
    if (this.payments.get(paymentId)?.status === "captured") {
      this.calls.push("capturePayment");
      throw new GatewayError("This payment has already been captured", 400, "BAD_REQUEST_ERROR");
    }
    return super.capturePayment(paymentId, amountPaise);
  }
}

describe.skipIf(!REAL_PG_URL)("Razorpay payment races on real PostgreSQL", () => {
  let env: Awaited<ReturnType<typeof createRealDatabase>>;
  let gateway: StrictGateway;
  let deps: BillingDeps;
  let maxInFlight = 0;

  beforeAll(async () => {
    env = await createRealDatabase(POOL);
    gateway = new StrictGateway();
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
    deps = {
      repo,
      gateway,
      availability: { enabled: true, mode: "test", keyId: KEY_ID, reason: null },
      config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" },
    };
  }, 120_000);

  afterAll(async () => {
    // The whole-database check runs last, over every scenario's data.
    await env?.drop();
  });

  /** Runs every task at once and records how many were in flight together. */
  async function all<T>(tasks: (() => Promise<T>)[]) {
    let inFlight = 0;
    const results = await Promise.allSettled(
      tasks.map(async (t) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          return await t();
        } finally {
          inFlight--;
        }
      }),
    );
    return results;
  }
  const values = <T,>(rs: PromiseSettledResult<T>[]) => {
    const rejected = rs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.map((r) => String(r.reason))).toEqual([]);
    return rs.map((r) => (r as PromiseFulfilledResult<T>).value);
  };

  const send = (w: ReturnType<typeof webhook>, d: BillingDeps = deps) => handleRazorpayWebhook(d, w.body, w.headers);
  const buyer = async () => {
    const u = await realUser(env.sql);
    return { ...u, user: { id: u.userId, email: null as string | null } };
  };
  const order = (u: Awaited<ReturnType<typeof buyer>>, packId = "solo") => createPackOrder(deps, u.user, { packId, idempotencyKey: randomUUID() });

  /** The three success criteria, for one shop. Returns the balance. */
  async function expectSettledCorrectly(shopId: string) {
    const [b] = await env.sql<{ balance: number; ledger: number; lots: number; neg: number }[]>`
      select (select balance from public.credit_balances where shop_id = ${shopId}) as balance,
             (select coalesce(sum(amount), 0)::int from public.credit_ledger where shop_id = ${shopId}) as ledger,
             (select coalesce(sum(remaining), 0)::int from public.credit_grants where shop_id = ${shopId}) as lots,
             (select count(*)::int from public.credit_grants where shop_id = ${shopId} and remaining < 0) as neg`;
    expect(b!.ledger).toBe(b!.balance);
    expect(b!.lots).toBe(b!.balance);
    expect(b!.neg).toBe(0);

    const payments = await env.sql<{ status: string; grants: number; credits: number }[]>`
      select p.status, (select count(*)::int from public.credit_grants g where g.payment_id = p.id and g.source = 'pack') as grants, p.credits_granted as credits
        from public.billing_payments p where p.shop_id = ${shopId} and p.kind = 'pack'`;
    for (const p of payments) {
      if (p.status === "captured") expect(p.grants, "captured payment must have exactly one grant").toBe(1);
      else expect(p.grants, `${p.status} payment must have no grant`).toBe(0);
    }
    const orders = await env.sql<{ status: string; captured: number; grants: number; credits: number }[]>`
      select o.status, o.credits,
             (select count(*)::int from public.billing_payments p where p.order_id = o.id and p.status = 'captured') as captured,
             (select count(*)::int from public.credit_grants g where g.idempotency_key = 'grant:order:' || o.razorpay_order_id) as grants
        from public.billing_orders o where o.shop_id = ${shopId}`;
    for (const o of orders) {
      expect(o.status === "paid", "order is paid exactly when a payment was captured").toBe(o.captured > 0);
      expect(o.grants, "at most one grant per order").toBe(o.captured > 0 ? 1 : 0);
    }
    return b!.balance;
  }
  const trial = billingConfig.trial.credits;

  it("three concurrent deliveries of one captured-payment webhook grant once", async () => {
    const u = await buyer();
    const o = await order(u);
    const { payment } = gateway.payOrder(o.orderId);
    const w = webhook("payment.captured", { payment }, { eventId: `evt_${randomUUID()}` });
    const outcomes = values(await all([() => send(w), () => send(w), () => send(w)])).map((r) => r.outcome).sort();
    expect(outcomes.filter((x) => x === "pack_granted")).toHaveLength(1);
    expect(outcomes.filter((x) => x === "duplicate")).toHaveLength(2);
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("checkout verification and webhooks arriving together, across 12 shops at once, grant each order once", async () => {
    const shops = await Promise.all(Array.from({ length: 12 }, buyer));
    const tasks: (() => Promise<unknown>)[] = [];
    for (const u of shops) {
      const o = await order(u, "signature");
      const { checkout, payment } = gateway.payOrder(o.orderId);
      tasks.push(
        () => verifyPackPayment(deps, u.userId, checkout),
        () => send(webhook("payment.captured", { payment })),
        () => send(webhook("order.paid", { payment, order: gateway.orders.get(o.orderId) })),
      );
    }
    values(await all(tasks)); // 36 concurrent requests
    for (const u of shops) expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 75);
  });

  it("20 concurrent deliveries with the same event id are processed once", async () => {
    const u = await buyer();
    const o = await order(u);
    const { payment } = gateway.payOrder(o.orderId);
    const eventId = `evt_${randomUUID()}`;
    const w = webhook("payment.captured", { payment }, { eventId });
    const outcomes = values(await all(Array.from({ length: 20 }, () => () => send(w)))).map((r) => r.outcome);
    expect(outcomes.filter((x) => x === "pack_granted")).toHaveLength(1);
    const [e] = await env.sql<{ attempts: number; processed: boolean; rows: number }[]>`
      select max(attempts)::int as attempts, bool_and(processed_at is not null) as processed, count(*)::int as rows
        from public.billing_webhook_events where event_id = ${eventId}`;
    expect(e).toEqual({ attempts: 20, processed: true, rows: 1 });
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("25 concurrent grant_credits calls with one payment's key allocate once (database-level)", async () => {
    const u = await buyer();
    const o = await order(u);
    const { checkout } = gateway.payOrder(o.orderId);
    await verifyPackPayment(deps, u.userId, checkout);
    const [p] = await env.sql<{ id: string }[]>`select id from public.billing_payments where razorpay_payment_id = ${checkout.razorpay_payment_id}`;
    const ids = values(
      await all(
        Array.from({ length: 25 }, () => () =>
          env.sql<{ id: string | null }[]>`select public.grant_credits(${u.shopId}::uuid, 20, 'pack', now() + interval '365 days', ${`grant:order:${o.orderId}`}, 'race', null, ${p!.id}::uuid) as id`,
        ),
      ),
    ).map((r) => r[0]!.id);
    expect(ids.filter(Boolean)).toHaveLength(0); // already granted by verify; every racer gets null
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("10 concurrent grants for one payment under 10 different keys: the unique index lets exactly one through", async () => {
    const u = await buyer();
    const o = await order(u);
    // A captured payment recorded without its grant yet (as if every settlement path were about to credit it).
    const { payment } = gateway.payOrder(o.orderId);
    const orderRow = (await deps.repo.orderByRazorpayId(o.orderId))!;
    const p = await deps.repo.upsertPayment({
      shopId: u.shopId, razorpayPaymentId: payment.id, kind: "pack", orderId: orderRow.id, subscriptionId: null,
      amountPaise: payment.amount, currency: "INR", status: "captured", method: "card", errorCode: null, errorDescription: null, description: "race",
    });
    await deps.repo.markOrderPaid(orderRow.id);
    const results = await all(
      Array.from({ length: 10 }, (_, i) => () =>
        env.sql<{ id: string | null }[]>`select public.grant_credits(${u.shopId}::uuid, 20, 'pack', now() + interval '365 days', ${`grant:racer:${i}`}, 'race', null, ${p!.id}::uuid) as id`,
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(9);
    for (const r of refused) expect(String(r.reason)).toMatch(/credit_grants_one_paid_grant_per_payment/);
    const [b] = await env.sql<{ balance: number; ledger: number; lots: number }[]>`
      select (select balance from public.credit_balances where shop_id = ${u.shopId}) as balance,
             (select coalesce(sum(amount), 0)::int from public.credit_ledger where shop_id = ${u.shopId}) as ledger,
             (select coalesce(sum(remaining), 0)::int from public.credit_grants where shop_id = ${u.shopId}) as lots`;
    expect(b).toEqual({ balance: trial + 20, ledger: trial + 20, lots: trial + 20 }); // rolled back racers left no trace
  });

  it("a transaction failure is retried safely, even by 5 concurrent retries", async () => {
    const u = await buyer();
    const o = await order(u);
    const { payment } = gateway.payOrder(o.orderId);
    const w = webhook("payment.captured", { payment }, { eventId: `evt_${randomUUID()}` });
    const failingRepo = new BillingRepository(env.db);
    failingRepo.withTx = (() => Promise.reject(new Error("Connection terminated unexpectedly"))) as BillingRepository["withTx"];
    expect(await send(w, { ...deps, repo: failingRepo })).toEqual({ status: 500, outcome: "error" });
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial);
    const outcomes = values(await all(Array.from({ length: 5 }, () => () => send(w)))).map((r) => r.outcome);
    expect(outcomes.filter((x) => x === "pack_granted")).toHaveLength(1);
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("a payment captured by verify, with the webhook arriving later, grants once", async () => {
    const u = await buyer();
    const o = await order(u);
    const { checkout, payment } = gateway.payOrder(o.orderId);
    expect((await verifyPackPayment(deps, u.userId, checkout)).creditsGranted).toBe(20);
    const late = values(await all([() => send(webhook("payment.captured", { payment })), () => send(webhook("order.paid", { payment, order: gateway.orders.get(o.orderId) }))]));
    expect(late.map((r) => r.outcome)).toEqual(["pack_already_granted", "pack_already_granted"]);
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("a failed attempt then a captured attempt on the same order (events racing) credits only the captured one, once", async () => {
    const u = await buyer();
    const o = await order(u);
    const failed = gateway.payOrder(o.orderId, { status: "failed" });
    const ok = gateway.payOrder(o.orderId);
    const results = values(
      await all<unknown>([
        () => send(webhook("payment.failed", { payment: failed.payment })),
        () => send(webhook("payment.captured", { payment: ok.payment })),
        () => verifyPackPayment(deps, u.userId, failed.checkout),
        () => verifyPackPayment(deps, u.userId, ok.checkout),
      ]),
    );
    expect((results[2] as { status: string }).status).toBe("failed");
    const rows = await env.sql<{ id: string; status: string; credits: number }[]>`
      select razorpay_payment_id as id, status, credits_granted as credits from public.billing_payments where order_id = (select id from public.billing_orders where razorpay_order_id = ${o.orderId})`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [failed.payment.id]: "failed", [ok.payment.id]: "captured" });
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("concurrent capture attempts on one authorized payment (3 webhooks + 2 verifies) capture and grant once", async () => {
    const u = await buyer();
    const o = await order(u);
    const { checkout, payment } = gateway.payOrder(o.orderId, { status: "authorized" });
    const before = gateway.calls.filter((c) => c === "capturePayment").length;
    values(
      await all<unknown>([
        () => send(webhook("payment.authorized", { payment })),
        () => send(webhook("payment.authorized", { payment })),
        () => send(webhook("order.paid", { payment, order: gateway.orders.get(o.orderId) })),
        () => verifyPackPayment(deps, u.userId, checkout),
        () => verifyPackPayment(deps, u.userId, checkout),
      ]),
    );
    expect(gateway.payments.get(payment.id)!.status).toBe("captured");
    expect(gateway.calls.filter((c) => c === "capturePayment").length - before).toBeGreaterThanOrEqual(1);
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("retries after a committed verify whose response was lost (5 at once) add nothing", async () => {
    const u = await buyer();
    const o = await order(u);
    const { checkout } = gateway.payOrder(o.orderId);
    await verifyPackPayment(deps, u.userId, checkout); // committed; the client never saw the reply
    const retries = values(await all(Array.from({ length: 5 }, () => () => verifyPackPayment(deps, u.userId, checkout))));
    expect(retries.map((r) => [r.status, r.creditsGranted])).toEqual(Array.from({ length: 5 }, () => ["confirmed", 0]));
    expect(await expectSettledCorrectly(u.shopId)).toBe(trial + 20);
  });

  it("whole database: no payment has more than one grant, and nothing uncaptured was credited", async () => {
    const [r] = await env.sql<{ dup: number; uncaptured: number; orders_dup: number }[]>`
      select
        (select count(*)::int from (select payment_id from public.credit_grants where source = 'pack' and payment_id is not null group by payment_id having count(*) > 1) d) as dup,
        (select count(*)::int from public.credit_grants g join public.billing_payments p on p.id = g.payment_id where g.source = 'pack' and p.status <> 'captured') as uncaptured,
        (select count(*)::int from (select o.id from public.billing_orders o join public.billing_payments p on p.order_id = o.id join public.credit_grants g on g.payment_id = p.id and g.source = 'pack' group by o.id having count(*) > 1) d) as orders_dup`;
    expect(r).toEqual({ dup: 0, uncaptured: 0, orders_dup: 0 });
    console.log(`[payment-races] max concurrent requests in one scenario: ${maxInFlight}; pool ${POOL} connections`);
  });
});

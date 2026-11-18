import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { billingConfig } from "@/config/billing";
import { BillingRepository } from "@/server/billing/repository";
import { createPackOrder, handleRazorpayWebhook, verifyPackPayment, type BillingDeps } from "@/server/billing/service";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createRealDatabase, REAL_PG_URL, realUser } from "./real-postgres";

/**
 * Refunds and first-purchase-only packs under genuinely parallel requests,
 * each on its own connection of a real PostgreSQL server (TEST_DATABASE_URL:
 * a disposable superuser connection, e.g. the CI service; never production).
 * PGlite runs one transaction at a time, so it can't show these races; the
 * same behaviour is covered sequentially in tests/billing/payment-safety.test.ts.
 */
describe.skipIf(!REAL_PG_URL)("refund and first-purchase races on real PostgreSQL", () => {
  let env: Awaited<ReturnType<typeof createRealDatabase>>;
  let gateway: FakeGateway;
  let deps: BillingDeps;
  const trial = billingConfig.trial.credits;

  beforeAll(async () => {
    env = await createRealDatabase(24);
    gateway = new FakeGateway();
    const repo = new BillingRepository(env.db);
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

  afterAll(async () => env?.drop());

  const send = (w: ReturnType<typeof webhook>) => handleRazorpayWebhook(deps, w.body, w.headers);
  const buyer = async () => {
    const u = await realUser(env.sql);
    return { ...u, user: { id: u.userId, email: null as string | null } };
  };
  const balanceOf = async (shopId: string) => {
    const [b] = await env.sql<{ balance: number; ledger: number; lots: number }[]>`
      select (select balance from public.credit_balances where shop_id = ${shopId}) as balance,
             (select coalesce(sum(amount), 0)::int from public.credit_ledger where shop_id = ${shopId}) as ledger,
             (select coalesce(sum(remaining), 0)::int from public.credit_grants where shop_id = ${shopId}) as lots`;
    expect(b!.ledger).toBe(b!.balance);
    expect(b!.lots).toBe(b!.balance);
    return b!.balance;
  };
  async function paidStudio(u: Awaited<ReturnType<typeof buyer>>) {
    const o = await createPackOrder(deps, u.user, { packId: "studio", idempotencyKey: randomUUID() });
    const { checkout, payment } = gateway.payOrder(o.orderId);
    await verifyPackPayment(deps, u.userId, checkout);
    return payment;
  }

  it("four concurrent 20% refunds of one payment take back exactly 80% of its credits", async () => {
    const u = await buyer();
    const payment = await paidStudio(u); // 500 credits
    const part = payment.amount / 5;
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        send(webhook("refund.processed", {
          refund: { id: `rfnd_${randomUUID().slice(0, 8)}_${i}`, payment_id: payment.id, amount: part, status: "processed" },
          payment: { ...payment, amount_refunded: part * 4 }, // each event may already report the latest total
        })),
      ),
    );
    expect(results.map((r) => r.outcome)).toEqual(Array(4).fill("refund_processed"));
    const [r] = await env.sql<{ reversed: number }[]>`
      select coalesce(sum(credits_reversed + credits_shortfall), 0)::int as reversed
        from public.billing_refunds rf join public.billing_payments p on p.id = rf.payment_id where p.razorpay_payment_id = ${payment.id}`;
    expect(r!.reversed).toBe(400);
    expect(await balanceOf(u.shopId)).toBe(trial + 100);
  });

  it("one refund delivered as five concurrent events is applied once", async () => {
    const u = await buyer();
    const payment = await paidStudio(u);
    const refund = { id: `rfnd_${randomUUID().slice(0, 8)}`, payment_id: payment.id, amount: payment.amount, status: "processed" };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(webhook("refund.processed", { refund, payment: { ...payment, amount_refunded: payment.amount } }))),
    );
    expect(results.filter((r) => r.outcome === "refund_processed")).toHaveLength(1);
    const [row] = await env.sql<{ credits_reversed: number }[]>`select credits_reversed from public.billing_refunds where razorpay_refund_id = ${refund.id}`;
    expect(row!.credits_reversed).toBe(500);
    expect(await balanceOf(u.shopId)).toBe(trial);
  });

  it("five Starter Pack orders opened before any is paid, all settling at once: exactly one is granted", async () => {
    const u = await buyer();
    const orders = [];
    for (let i = 0; i < 5; i++) orders.push(await createPackOrder(deps, u.user, { packId: "starter-pack", idempotencyKey: randomUUID() }));
    const payments = orders.map((o) => gateway.payOrder(o.orderId));
    const results = await Promise.all(
      payments.flatMap((p) => [() => send(webhook("payment.captured", { payment: p.payment })), () => verifyPackPayment(deps, u.userId, p.checkout).catch((e: Error) => e)]).map((f) => f()),
    );
    expect(results.filter((r) => !(r instanceof Error) && "outcome" in r && r.outcome === "pack_granted").length
      + results.filter((r) => !(r instanceof Error) && "creditsGranted" in r && r.creditsGranted > 0).length).toBe(1);
    expect(await balanceOf(u.shopId)).toBe(trial + 3);
    const [g] = await env.sql<{ grants: number; paid: number }[]>`
      select (select count(*)::int from public.credit_grants where shop_id = ${u.shopId} and source = 'pack') as grants,
             (select count(*)::int from public.billing_orders where shop_id = ${u.shopId} and status = 'paid') as paid`;
    expect(g).toEqual({ grants: 1, paid: 5 }); // all five recorded (four to refund), one credited
  });
});

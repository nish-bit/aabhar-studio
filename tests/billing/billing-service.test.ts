import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { billingConfig, packById, paidPlans, planById } from "@/config/billing";
import type { BillingAvailability } from "@/lib/billing-types";
import { loadEntitlement } from "@/server/billing/entitlements";
import { ensureReferralCode, getReferralSummary, recordReferral } from "@/server/referrals/service";
import { BillingRepository } from "@/server/billing/repository";
import {
  cancelSubscription,
  changePlan,
  createPackOrder,
  createSubscription,
  getBillingOverview,
  getReceiptData,
  handleRazorpayWebhook,
  reconcileBilling,
  verifyPackPayment,
  verifySubscriptionPayment,
  type BillingDeps,
} from "@/server/billing/service";
import { DomainError } from "@/server/generation/domain-error";
import type { Db } from "@/server/db/sql";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Billing lifecycle against the real SQL (PGlite) and a fake Razorpay with
 * real HMAC signatures. Covers: verified-only grants, idempotency across the
 * verify call and webhooks, amount checks, renewals, failures, cancellation,
 * expiry, refunds, replay/duplicate/out-of-order webhooks and receipts.
 */

let pg: PGlite;
let db: Db;
let gateway: FakeGateway;
let deps: BillingDeps;
let user: { id: string; email: string | null };
let shopId: string;

const availability: BillingAvailability = { enabled: true, mode: "test", keyId: KEY_ID, reason: null };

async function syncCatalog(repo: BillingRepository, g: FakeGateway) {
  for (const [i, p] of billingConfig.plans.entries()) {
    await repo.upsertPlan({ id: p.id, name: p.name, monthlyCredits: p.monthlyCredits, limits: p.limits, isPaid: p.monthlyPricePaise !== null, sortOrder: i });
  }
  for (const p of paidPlans()) {
    const rp = await g.createPlan({ name: p.name, amountPaise: p.monthlyPricePaise });
    await repo.insertPrice({ planId: p.id, mode: "test", amountPaise: p.monthlyPricePaise, razorpayPlanId: rp.id });
  }
  for (const [i, k] of billingConfig.packs.entries()) {
    await repo.upsertPack({ id: k.id, name: k.name, credits: k.credits, amountPaise: k.pricePaise, validityDays: k.validityDays, sortOrder: i });
  }
}

beforeEach(async () => {
  ({ pg, db } = await createTestDatabase());
  gateway = new FakeGateway();
  const repo = new BillingRepository(db);
  await syncCatalog(repo, gateway);
  deps = { repo, gateway, availability, config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" } };
  const u = await createUser(pg);
  user = { id: u.userId, email: "owner@example.test" };
  shopId = u.shopId;
}, 60_000);

const balance = () => deps.repo.balance(shopId);
const send = (w: ReturnType<typeof webhook>) => handleRazorpayWebhook(deps, w.body, w.headers);

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

async function ledgerTotal() {
  const { rows } = await pg.query<{ s: number }>("select coalesce(sum(amount),0)::int as s from public.credit_ledger where shop_id = $1", [shopId]);
  return rows[0]!.s;
}

async function grantsTotal() {
  const { rows } = await pg.query<{ s: number }>("select coalesce(sum(remaining),0)::int as s from public.credit_grants where shop_id = $1", [shopId]);
  return rows[0]!.s;
}

/** The cached balance, the ledger and the grant lots must always agree. */
async function expectConsistent() {
  const b = await balance();
  expect(await ledgerTotal()).toBe(b);
  expect(await grantsTotal()).toBe(b);
}

/* ===================================================================== packs */

describe("credit packs", () => {
  it("grants credits only after Razorpay confirms capture, exactly once", async () => {
    const pack = packById("solo")!;
    const order = await createPackOrder(deps, user, { packId: pack.id, idempotencyKey: randomUUID() });
    expect(order.checkout.amount).toBe(pack.pricePaise); // amount comes from server config
    expect(order.checkout.key).toBe(KEY_ID);
    expect(JSON.stringify(order)).not.toContain(KEY_SECRET);

    const { checkout } = gateway.payOrder(order.orderId);
    const r1 = await verifyPackPayment(deps, user.id, checkout);
    expect(r1).toMatchObject({ status: "confirmed", creditsGranted: 20, balance: 22 });

    // Replayed verify, then both webhooks Razorpay sends for the same payment: no extra credits.
    const r2 = await verifyPackPayment(deps, user.id, checkout);
    expect(r2.creditsGranted).toBe(0);
    const payment = gateway.payments.get(checkout.razorpay_payment_id)!;
    expect((await send(webhook("payment.captured", { payment })))).toMatchObject({ status: 200, outcome: "pack_already_granted" });
    expect((await send(webhook("order.paid", { payment, order: gateway.orders.get(order.orderId) }))).outcome).toBe("pack_already_granted");
    expect(await balance()).toBe(22);
    await expectConsistent();

    const packGrant = (await deps.repo.activeGrants(shopId)).find((g) => g.source === "pack")!;
    const days = (new Date(packGrant.expiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(pack.validityDays - 1);
  });

  it("buying any pack unlocks all styles and the pack limits; a full refund takes them away again", async () => {
    expect((await loadEntitlement(deps.repo, shopId)).state).toBe("trial");
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout, payment } = gateway.payOrder(order.orderId);
    await verifyPackPayment(deps, user.id, checkout);
    const e = await loadEntitlement(deps.repo, shopId);
    expect(e).toMatchObject({ state: "pack", limits: { presets: "all", maxCatalogues: 25 } });

    const refund = { id: "rfnd_full", payment_id: payment.id, amount: payment.amount, status: "processed" };
    await send(webhook("refund.processed", { refund, payment: { ...payment, amount_refunded: payment.amount } }));
    expect((await loadEntitlement(deps.repo, shopId)).state).toBe("trial");
  });

  it("refuses a pack that isn't synced to the database yet, before contacting Razorpay", async () => {
    await pg.query("update public.credit_packs set active = false where id = 'signature'");
    try {
      await expectCode(createPackOrder(deps, user, { packId: "signature", idempotencyKey: randomUUID() }), "billing_not_configured");
      expect(gateway.calls).not.toContain("createOrder");
    } finally {
      await pg.query("update public.credit_packs set active = true where id = 'signature'");
    }
  });

  it("sells exactly the configured packs: Starter 3 / ₹249 (first purchase), Solo 20 / ₹1,499, Signature 75 / ₹3,999, Studio 500 / ₹19,999", () => {
    expect(billingConfig.packs.map((p) => [p.id, p.credits, p.pricePaise])).toEqual([
      ["starter-pack", 3, 24_900],
      ["solo", 20, 149_900],
      ["signature", 75, 399_900],
      ["studio", 500, 1_999_900],
    ]);
  });

  it("rejects a forged checkout signature and grants nothing", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId);
    await expectCode(verifyPackPayment(deps, user.id, { ...checkout, razorpay_signature: "0".repeat(64) }), "payment_failed");
    expect(await balance()).toBe(2);
  });

  it("never grants when the frontend says success but Razorpay hasn't captured", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId, { status: "failed" });
    const r = await verifyPackPayment(deps, user.id, checkout);
    expect(r.status).toBe("pending");
    expect(await balance()).toBe(2);
  });

  it("refuses a payment whose amount doesn't match the order", async () => {
    const order = await createPackOrder(deps, user, { packId: "signature", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId, { amount: 100 });
    await expectCode(verifyPackPayment(deps, user.id, checkout), "payment_failed");
    const payment = gateway.payments.get(checkout.razorpay_payment_id)!;
    expect((await send(webhook("payment.captured", { payment }))).outcome).toBe("pack_mismatch");
    expect(await balance()).toBe(2);
  });

  it("captures an authorized payment server-side before granting", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId, { status: "authorized" });
    expect((await verifyPackPayment(deps, user.id, checkout)).status).toBe("confirmed");
    expect(gateway.calls).toContain("capturePayment");
    expect(await balance()).toBe(22);
  });

  it("falls back to the webhook when Razorpay can't be reached during verify", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout, payment } = gateway.payOrder(order.orderId);
    gateway.down = true;
    expect((await verifyPackPayment(deps, user.id, checkout)).status).toBe("pending");
    expect(await balance()).toBe(2);
    gateway.down = false;
    expect((await send(webhook("payment.captured", { payment }))).outcome).toBe("pack_granted");
    expect(await balance()).toBe(22);
  });

  it("reconcile cron confirms a paid order whose webhook never arrived", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    gateway.payOrder(order.orderId);
    await pg.query("update public.billing_orders set created_at = now() - interval '20 minutes'");
    expect((await reconcileBilling(deps)).ordersConfirmed).toBe(1);
    expect(await balance()).toBe(22);
  });

  it("reuses the same order for a retried click, and only owners can buy", async () => {
    const key = randomUUID();
    const a = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: key });
    const b = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: key });
    expect(b.orderId).toBe(a.orderId);
    expect(gateway.calls.filter((c) => c === "createOrder")).toHaveLength(1);

    const editor = randomUUID();
    await pg.query("insert into auth.users (id, email) values ($1, 'e@test.local')", [editor]);
    await pg.query("delete from public.shop_members where user_id = $1", [editor]);
    await pg.query("insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'editor')", [shopId, editor]);
    await expectCode(createPackOrder(deps, { id: editor, email: null }, { packId: "solo", idempotencyKey: randomUUID() }), "forbidden");
  });

  it("can't verify another shop's order", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId);
    const other = await createUser(pg);
    await expectCode(verifyPackPayment(deps, other.userId, checkout), "not_found");
    expect(await deps.repo.balance(other.shopId)).toBe(2);
  });
});

/* ======================================================== starter + referrals */

async function buy(packId: string, who = user) {
  const order = await createPackOrder(deps, who, { packId, idempotencyKey: randomUUID() });
  const { checkout, payment } = gateway.payOrder(order.orderId);
  await verifyPackPayment(deps, who.id, checkout);
  return payment;
}

describe("Starter Pack (first purchase only)", () => {
  it("can be bought once, as the first purchase; afterwards it's refused before contacting Razorpay", async () => {
    expect((await getBillingOverview(deps, user.id)).firstPurchaseAvailable).toBe(true);
    await buy("starter-pack");
    expect(await balance()).toBe(2 + 3);
    expect((await getBillingOverview(deps, user.id)).firstPurchaseAvailable).toBe(false);
    const ordersBefore = gateway.calls.filter((c) => c === "createOrder").length;
    await expectCode(createPackOrder(deps, user, { packId: "starter-pack", idempotencyKey: randomUUID() }), "conflict");
    expect(gateway.calls.filter((c) => c === "createOrder")).toHaveLength(ordersBefore);
  });

  it("isn't available to someone who already bought another plan, even after a refund", async () => {
    const payment = await buy("solo");
    await send(webhook("refund.processed", { refund: { id: "rf_s", payment_id: payment.id, amount: payment.amount, status: "processed" }, payment: { ...payment, amount_refunded: payment.amount } }));
    await expectCode(createPackOrder(deps, user, { packId: "starter-pack", idempotencyKey: randomUUID() }), "conflict");
  });
});

describe("referrals", () => {
  async function invitedBy() {
    const inviter = await createUser(pg);
    const code = await ensureReferralCode(db, inviter.userId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await ensureReferralCode(db, inviter.userId)).toBe(code); // stable
    expect(await recordReferral(db, user.id, code)).toBe(true);
    return { inviter, code };
  }
  const inviterBalance = (shop: string) => deps.repo.balance(shop);

  it("rewards both sides once, on the first Solo-or-larger purchase; Starter doesn't count; duplicate webhooks don't pay twice", async () => {
    const { inviter } = await invitedBy();
    await buy("starter-pack");
    expect(await inviterBalance(inviter.shopId)).toBe(2);

    const payment = await buy("solo");
    expect(await inviterBalance(inviter.shopId)).toBe(2 + 10);
    expect(await balance()).toBe(2 + 3 + 20 + 2);
    await send(webhook("payment.captured", { payment }));
    await buy("signature");
    expect(await inviterBalance(inviter.shopId)).toBe(12); // only the first qualifying purchase
    expect(await getReferralSummary(db, inviter.userId)).toMatchObject({ invited: 1, rewarded: 1, creditsEarned: 10 });
    await expectConsistent();
  });

  it("takes both rewards back when the qualifying payment is fully refunded", async () => {
    const { inviter } = await invitedBy();
    const payment = await buy("solo");
    expect(await inviterBalance(inviter.shopId)).toBe(12);
    await send(webhook("refund.processed", { refund: { id: "rf_r", payment_id: payment.id, amount: payment.amount, status: "processed" }, payment: { ...payment, amount_refunded: payment.amount } }));
    expect(await inviterBalance(inviter.shopId)).toBe(2);
    expect(await balance()).toBe(2);
    const { rows } = await pg.query<{ status: string }>("select status from public.referrals where referee_user_id = $1", [user.id]);
    expect(rows[0]!.status).toBe("reversed");
  });

  it("blocks self-referral, unknown codes and being referred twice", async () => {
    const own = await ensureReferralCode(db, user.id);
    expect(await recordReferral(db, user.id, own)).toBe(false);
    expect(await recordReferral(db, user.id, "ZZZZZZZZ")).toBe(false);
    expect(await recordReferral(db, user.id, "bad")).toBe(false);
    const { code } = await invitedBy();
    const other = await createUser(pg);
    expect(await recordReferral(db, user.id, await ensureReferralCode(db, other.userId))).toBe(false);
    expect(code).toBeTruthy();
  });
});

/* ============================================================= subscriptions */

async function subscribe(planId = "growth") {
  const res = await createSubscription(deps, user, { planId });
  const { checkout, payment } = gateway.chargeSubscription(res.subscriptionId);
  const v = await verifySubscriptionPayment(deps, user.id, checkout);
  return { subId: res.subscriptionId, payment, verify: v };
}

const subEntity = (subId: string) => ({ ...gateway.subscriptions.get(subId)!, entity: "subscription" });

describe("subscriptions", () => {
  it("activates, grants the month's credits expiring at period end, and enforces plan limits", async () => {
    const { subId, verify, payment } = await subscribe("growth");
    expect(verify).toMatchObject({ status: "confirmed", creditsGranted: 300, balance: 302 });

    // Razorpay also sends subscription.charged for the same payment: no double grant.
    expect((await send(webhook("subscription.charged", { subscription: subEntity(subId), payment }))).outcome).toBe("charge_already_granted");
    expect(await balance()).toBe(302);

    const o = await getBillingOverview(deps, user.id);
    expect(o.entitlement).toMatchObject({ planId: "growth", state: "subscribed" });
    expect(o.entitlement.limits).toEqual(planById("growth")!.limits);
    const planGrant = o.grants.find((g) => g.source === "plan")!;
    expect(new Date(planGrant.expiresAt!).getTime()).toBe(gateway.subscriptions.get(subId)!.current_end! * 1000);
    await expectConsistent();
  });

  it("grants again on renewal, keeps limits while Razorpay retries, then lapses when halted", async () => {
    const { subId } = await subscribe("starter");
    const renewal = gateway.chargeSubscription(subId);
    expect((await send(webhook("subscription.charged", { subscription: subEntity(subId), payment: renewal.payment }))).outcome).toBe("charge_granted");
    expect(await balance()).toBe(2 + 100 + 100);

    const failed = gateway.chargeSubscription(subId, { status: "failed" });
    gateway.subscriptions.get(subId)!.status = "pending";
    await send(webhook("subscription.pending", { subscription: subEntity(subId), payment: failed.payment }));
    let o = await getBillingOverview(deps, user.id);
    expect(o.entitlement).toMatchObject({ state: "past_due", limits: planById("starter")!.limits });
    expect(o.payments.find((p) => p.status === "failed")?.errorDescription).toBe("Card declined");
    expect(await balance()).toBe(202); // a failed charge grants nothing

    gateway.subscriptions.get(subId)!.status = "halted";
    await send(webhook("subscription.halted", { subscription: subEntity(subId) }, { createdAt: Math.floor(Date.now() / 1000) + 5 }));
    o = await getBillingOverview(deps, user.id);
    expect(o.entitlement).toMatchObject({ state: "past_due", limits: billingConfig.lapsedLimits });
    expect(o.balance).toBe(202); // existing credits stay usable

    // Subscribing again from halted ends the old one and starts fresh.
    const again = await createSubscription(deps, user, { planId: "starter" });
    expect(again.subscriptionId).not.toBe(subId);
    expect(gateway.subscriptions.get(subId)!.status).toBe("cancelled");
  });

  it("cancel at period end keeps the plan until current_end, then lapses", async () => {
    const { subId } = await subscribe("growth");
    const view = await cancelSubscription(deps, user.id, true);
    expect(view.cancelAtCycleEnd).toBe(true);
    expect((await getBillingOverview(deps, user.id)).entitlement.state).toBe("subscribed");

    gateway.subscriptions.get(subId)!.status = "cancelled";
    await send(webhook("subscription.cancelled", { subscription: subEntity(subId) }, { createdAt: Math.floor(Date.now() / 1000) + 5 }));
    expect((await getBillingOverview(deps, user.id)).entitlement.state).toBe("grace");

    // After the paid period: lapsed limits, and the month's credits expire.
    const end = new Date(gateway.subscriptions.get(subId)!.current_end! * 1000 + 1000);
    expect((await getBillingOverview({ ...deps, now: () => end }, user.id)).entitlement).toMatchObject({ state: "lapsed", limits: billingConfig.lapsedLimits });
    await pg.query("update public.credit_grants set expires_at = now() - interval '1 second' where source = 'plan'");
    await reconcileBilling(deps);
    expect(await balance()).toBe(2);
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.credit_ledger where entry_type = 'expiry'");
    expect(rows[0]!.n).toBe(1);
    await expectConsistent();
  });

  it("schedules a plan change for the next renewal, and applies new plan credits on that charge", async () => {
    const { subId } = await subscribe("starter");
    const r = await changePlan(deps, user.id, { planId: "premium" });
    expect(r.status).toBe("scheduled");
    expect(r.subscription?.scheduledPlanId).toBe("premium");

    // At renewal Razorpay switches the plan and charges the new price.
    const premiumPrice = await deps.repo.activePrice("premium", "test");
    gateway.subscriptions.get(subId)!.plan_id = premiumPrice!.razorpayPlanId;
    const renewal = gateway.chargeSubscription(subId);
    expect((await send(webhook("subscription.charged", { subscription: subEntity(subId), payment: renewal.payment }))).outcome).toBe("charge_granted");
    const o = await getBillingOverview(deps, user.id);
    expect(o.subscription).toMatchObject({ planId: "premium", scheduledPlanId: null });
    expect(o.balance).toBe(2 + 100 + 1000);
  });

  it("tells UPI / eMandate subscribers to resubscribe when Razorpay refuses a plan update", async () => {
    await subscribe("starter");
    gateway.rejectPlanUpdates = true;
    expect((await changePlan(deps, user.id, { planId: "growth" })).status).toBe("requires_resubscribe");
  });

  it("refuses a second live subscription and a mismatched charge amount", async () => {
    const { subId } = await subscribe("starter");
    await expectCode(createSubscription(deps, user, { planId: "growth" }), "conflict");
    const odd = gateway.chargeSubscription(subId, { amount: 1 });
    expect((await send(webhook("subscription.charged", { subscription: subEntity(subId), payment: odd.payment }))).outcome).toBe("charge_mismatch");
    expect(await balance()).toBe(102);
  });
});

/* ================================================================= webhooks */

describe("webhook security", () => {
  it("rejects bad signatures and tampered bodies", async () => {
    const w = webhook("payment.captured", { payment: { id: "pay_x" } });
    expect((await handleRazorpayWebhook(deps, w.body, { ...w.headers, signature: "deadbeef" })).status).toBe(400);
    expect((await handleRazorpayWebhook(deps, w.body.replace("pay_x", "pay_y"), w.headers)).status).toBe(400);
    const wrongSecret = webhook("payment.captured", { payment: { id: "pay_x" } }, { secret: "someone-elses-secret" });
    expect((await send(wrongSecret)).status).toBe(400);
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.billing_webhook_events");
    expect(rows[0]!.n).toBe(0); // nothing stored from unverified requests
  });

  it("processes a duplicate delivery only once", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment }, { eventId: "evt_same" });
    expect((await send(w)).outcome).toBe("pack_granted");
    expect((await send(w)).outcome).toBe("duplicate");
    const { rows } = await pg.query<{ attempts: number }>("select attempts from public.billing_webhook_events where event_id = 'evt_same'");
    expect(rows[0]!.attempts).toBe(2);
    expect(await balance()).toBe(22);
  });

  it("ignores replayed events older than the replay window", async () => {
    const old = Math.floor(Date.now() / 1000) - 8 * 86400;
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { payment } = gateway.payOrder(order.orderId);
    expect((await send(webhook("payment.captured", { payment }, { createdAt: old }))).outcome).toBe("stale_ignored");
    expect(await balance()).toBe(2);
  });

  it("doesn't let an older event overwrite a newer subscription state", async () => {
    const { subId } = await subscribe("growth");
    const t = Math.floor(Date.now() / 1000);
    gateway.subscriptions.get(subId)!.status = "cancelled";
    await send(webhook("subscription.cancelled", { subscription: subEntity(subId) }, { createdAt: t + 60 }));
    gateway.subscriptions.get(subId)!.status = "active";
    expect((await send(webhook("subscription.activated", { subscription: subEntity(subId) }, { createdAt: t + 30 }))).outcome).toBe("out_of_order_skipped");
    expect((await getBillingOverview(deps, user.id)).subscription?.status).toBe("cancelled");
  });

  it("ignores events for subscriptions and orders that aren't ours", async () => {
    expect((await send(webhook("subscription.charged", { subscription: { id: "sub_other", plan_id: "plan_x", status: "active" }, payment: { id: "pay_o", amount: 1 } }))).outcome).toBe("unknown_subscription");
    expect((await send(webhook("payment.captured", { payment: { id: "pay_o", order_id: "order_other", amount: 1, status: "captured" } }))).outcome).toBe("ignored_not_pack");
    expect(await balance()).toBe(2);
  });
});

/* ================================================================== refunds */

describe("refunds", () => {
  async function paidPack(packId = "signature") {
    const order = await createPackOrder(deps, user, { packId, idempotencyKey: randomUUID() });
    const { checkout, payment } = gateway.payOrder(order.orderId);
    await verifyPackPayment(deps, user.id, checkout);
    return payment;
  }

  it("removes refunded credits once, even if refund events repeat", async () => {
    const payment = await paidPack();
    expect(await balance()).toBe(77); // 2 trial + 75 Signature
    const refund = { id: "rfnd_1", payment_id: payment.id, amount: payment.amount, status: "processed" };
    await send(webhook("refund.created", { refund: { ...refund, status: "pending" }, payment }));
    expect(await balance()).toBe(77); // nothing removed until processed
    const pr = { ...payment, amount_refunded: payment.amount };
    expect((await send(webhook("refund.processed", { refund, payment: pr }))).outcome).toBe("refund_processed");
    expect((await send(webhook("refund.processed", { refund, payment: pr }))).outcome).toBe("refund_already_processed");
    expect(await balance()).toBe(2);
    const o = await getBillingOverview(deps, user.id);
    expect(o.payments[0]).toMatchObject({ status: "refunded", amountRefundedPaise: payment.amount });
    await expectConsistent();
  });

  it("removes a proportional share for partial refunds and records any shortfall", async () => {
    const payment = await paidPack("studio");
    // Spend 450 of the Studio pack's 500 credits (plan/trial credits expire sooner, so they go first).
    await pg.query("update public.credit_grants set remaining = 50 where source = 'pack'");
    await pg.query("update public.credit_balances set balance = balance - 450 where shop_id = $1", [shopId]);

    const half = Math.floor(payment.amount / 2);
    await send(webhook("refund.processed", { refund: { id: "rfnd_a", payment_id: payment.id, amount: half, status: "processed" }, payment: { ...payment, amount_refunded: half } }));
    const { rows } = await pg.query<{ credits_reversed: number; credits_shortfall: number }>(
      "select credits_reversed, credits_shortfall from public.billing_refunds where razorpay_refund_id = 'rfnd_a'",
    );
    expect(rows[0]).toEqual({ credits_reversed: 50, credits_shortfall: 200 }); // half of 500 = 250 owed, only 50 left
  });
});

/* ================================================================= receipts */

describe("receipts", () => {
  it("issues one sequential receipt number per payment, only for successful payments", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { checkout } = gateway.payOrder(order.orderId);
    await verifyPackPayment(deps, user.id, checkout);
    const paymentId = (await getBillingOverview(deps, user.id)).payments[0]!.id;

    const a = await getReceiptData(deps, user.id, paymentId);
    const b = await getReceiptData(deps, user.id, paymentId);
    expect(a.receiptNumber).toMatch(/^AS\/\d{4}-\d{2}\/000001$/);
    expect(b.receiptNumber).toBe(a.receiptNumber);
    expect(a.mode).toBe("test");
    expect(JSON.stringify(a)).not.toMatch(/card_|\b\d{12,19}\b/); // no card data anywhere

    const other = await createUser(pg);
    await expectCode(getReceiptData(deps, other.userId, paymentId), "not_found");
  });
});

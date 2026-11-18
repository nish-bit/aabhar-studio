import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { billingConfig, paidPlans } from "@/config/billing";
import type { BillingAvailability } from "@/lib/billing-types";
import { getBillingHealth } from "@/server/admin/billing";
import { requireAdmin } from "@/server/admin/guard";
import { BILLING_ERROR_EVENTS, billingLog, billingLogLevel } from "@/server/billing/log";
import { BillingRepository } from "@/server/billing/repository";
import { createPackOrder, handleRazorpayWebhook, reconcileBilling, verifyPackPayment, type BillingDeps } from "@/server/billing/service";
import { hmacHex } from "@/server/billing/signature";
import { DomainError } from "@/server/generation/domain-error";
import type { Db } from "@/server/db/sql";

import { makeAdmin, testAdminDeps } from "../support/admin-fixtures";
import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Razorpay payment safety: refund serialisation, first-purchase-only packs
 * enforced at grant time, error-level payment logs without personal data,
 * webhook body limits in bytes, and the admin billing health view.
 * Genuinely parallel refunds and Starter Pack payments also run on real
 * PostgreSQL in tests/pg/payment-races.test.ts (CI).
 */

const holder = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/server/billing/deps", () => ({ billingDeps: () => holder.deps }));

let pg: PGlite;
let db: Db;
let gateway: FakeGateway;
let deps: BillingDeps;
let user: { id: string; email: string | null };
let shopId: string;
const EMAIL = "owner.private@example.test";

const availability: BillingAvailability = { enabled: true, mode: "test", keyId: KEY_ID, reason: null };

beforeEach(async () => {
  ({ pg, db } = await createTestDatabase());
  gateway = new FakeGateway();
  const repo = new BillingRepository(db);
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
  deps = { repo, gateway, availability, config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" } };
  holder.deps = deps;
  const u = await createUser(pg);
  user = { id: u.userId, email: EMAIL };
  shopId = u.shopId;
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

const balance = () => deps.repo.balance(shopId);
const send = (w: ReturnType<typeof webhook>, d: BillingDeps = deps) => handleRazorpayWebhook(d, w.body, w.headers);
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

async function expectConsistent() {
  const { rows } = await pg.query<{ balance: number; ledger: number; lots: number }>(
    `select (select balance from public.credit_balances where shop_id = $1) as balance,
            (select coalesce(sum(amount), 0)::int from public.credit_ledger where shop_id = $1) as ledger,
            (select coalesce(sum(remaining), 0)::int from public.credit_grants where shop_id = $1) as lots`,
    [shopId],
  );
  expect(rows[0]!.ledger).toBe(rows[0]!.balance);
  expect(rows[0]!.lots).toBe(rows[0]!.balance);
}

async function paidPack(packId: string) {
  const order = await createPackOrder(deps, user, { packId, idempotencyKey: randomUUID() });
  const { checkout, payment } = gateway.payOrder(order.orderId);
  await verifyPackPayment(deps, user.id, checkout);
  return payment;
}

/* =============================================================== refunds */

describe("refund concurrency", () => {
  const refundRows = async (paymentId: string) =>
    (await pg.query<{ id: string; credits_reversed: number; credits_shortfall: number; status: string }>(
      `select r.razorpay_refund_id as id, r.credits_reversed, r.credits_shortfall, r.status
         from public.billing_refunds r join public.billing_payments p on p.id = r.payment_id
        where p.razorpay_payment_id = $1 order by r.razorpay_refund_id`,
      [paymentId],
    )).rows;

  it("locks the payment row before reading the payment and earlier reversals", async () => {
    const payment = await paidPack("studio");
    const calls: string[] = [];
    const proto = BillingRepository.prototype;
    for (const m of ["lockPayment", "paymentByRazorpayId", "refundByRazorpayId", "processedRefundTotal", "creditsAlreadyReversed", "reverseGrant"] as const) {
      const original = proto[m] as (...a: unknown[]) => Promise<unknown>;
      vi.spyOn(proto, m).mockImplementation(function (this: BillingRepository, ...args: unknown[]) {
        calls.push(m);
        return original.apply(this, args);
      } as never);
    }
    const half = payment.amount / 2;
    await send(webhook("refund.processed", { refund: { id: "rfnd_order", payment_id: payment.id, amount: half, status: "processed" }, payment: { ...payment, amount_refunded: half } }));

    const lock = calls.indexOf("lockPayment");
    expect(lock).toBeGreaterThan(-1);
    // The payment is read again after the lock, and every read about earlier refunds comes after it.
    expect(calls.indexOf("paymentByRazorpayId", lock)).toBeGreaterThan(lock);
    expect(calls.indexOf("refundByRazorpayId")).toBeGreaterThan(lock);
    expect(calls.indexOf("processedRefundTotal")).toBeGreaterThan(lock);
    expect(calls.indexOf("creditsAlreadyReversed")).toBeGreaterThan(lock);
    expect(calls.indexOf("reverseGrant")).toBeGreaterThan(calls.indexOf("creditsAlreadyReversed"));
  });

  it("two partial refunds delivered at once take back exactly the refunded share", async () => {
    const payment = await paidPack("studio"); // 500 credits
    expect(await balance()).toBe(2 + 500);
    const part = Math.round(payment.amount * 0.4);
    // Razorpay's payment entity carries the cumulative refunded amount at the time of each event.
    const a = webhook("refund.processed", { refund: { id: "rfnd_a", payment_id: payment.id, amount: part, status: "processed" }, payment: { ...payment, amount_refunded: part } });
    const b = webhook("refund.processed", { refund: { id: "rfnd_b", payment_id: payment.id, amount: part, status: "processed" }, payment: { ...payment, amount_refunded: part * 2 } });
    const outcomes = await Promise.all([send(a), send(b)]);
    expect(outcomes.map((o) => o.outcome)).toEqual(["refund_processed", "refund_processed"]);

    const rows = await refundRows(payment.id);
    expect(rows.reduce((s, r) => s + r.credits_reversed + r.credits_shortfall, 0)).toBe(400); // 80% of 500, not more
    expect(await balance()).toBe(2 + 100);
    const { rows: pay } = await pg.query<{ amount_refunded_paise: number; status: string }>(
      "select amount_refunded_paise::int as amount_refunded_paise, status from public.billing_payments where razorpay_payment_id = $1", [payment.id]);
    expect(pay[0]).toEqual({ amount_refunded_paise: part * 2, status: "partially_refunded" });
    await expectConsistent();
  });

  it("an earlier refund's event that already reports a later refund's amount doesn't make the later one count twice", async () => {
    const payment = await paidPack("studio");
    const part = Math.round(payment.amount * 0.4);
    // One after the other: the first event's payment total (80%) already includes the second refund.
    await send(webhook("refund.processed", { refund: { id: "rfnd_e", payment_id: payment.id, amount: part, status: "processed" }, payment: { ...payment, amount_refunded: part * 2 } }));
    expect(await balance()).toBe(2 + 300); // 40% of 500 taken back: this refund's share only
    await send(webhook("refund.processed", { refund: { id: "rfnd_f", payment_id: payment.id, amount: part, status: "processed" }, payment: { ...payment, amount_refunded: part * 2 } }));
    expect(await balance()).toBe(2 + 100); // 80% in total, not 100%
    const { rows } = await pg.query<{ amount_refunded_paise: number }>(
      "select amount_refunded_paise::int as amount_refunded_paise from public.billing_payments where razorpay_payment_id = $1", [payment.id]);
    expect(rows[0]!.amount_refunded_paise).toBe(part * 2); // displayed total follows Razorpay
    await expectConsistent();
  });

  it("partial refunds whose events both report the latest refunded total still don't over-reverse", async () => {
    const payment = await paidPack("studio");
    const part = Math.round(payment.amount * 0.4);
    const latest = { ...payment, amount_refunded: part * 2 };
    await Promise.all([
      send(webhook("refund.processed", { refund: { id: "rfnd_c", payment_id: payment.id, amount: part, status: "processed" }, payment: latest })),
      send(webhook("refund.processed", { refund: { id: "rfnd_d", payment_id: payment.id, amount: part, status: "processed" }, payment: latest })),
    ]);
    const rows = await refundRows(payment.id);
    expect(rows.reduce((s, r) => s + r.credits_reversed, 0)).toBe(400);
    expect(await balance()).toBe(2 + 100);
    await expectConsistent();
  });

  it("the same refund delivered as two different events at once is applied once, and its record keeps the reversal", async () => {
    const payment = await paidPack("signature"); // 75 credits
    const refund = { id: "rfnd_same", payment_id: payment.id, amount: payment.amount, status: "processed" };
    const full = { ...payment, amount_refunded: payment.amount };
    const outcomes = (await Promise.all([send(webhook("refund.processed", { refund, payment: full })), send(webhook("refund.processed", { refund, payment: full }))]))
      .map((o) => o.outcome)
      .sort();
    expect(outcomes).toEqual(["refund_already_processed", "refund_processed"]);
    expect(await refundRows(payment.id)).toEqual([{ id: "rfnd_same", credits_reversed: 75, credits_shortfall: 0, status: "processed" }]);
    expect(await balance()).toBe(2);
    await expectConsistent();
  });
});

/* =========================================================== starter pack */

describe("Starter Pack: first purchase only, enforced when credits are granted", () => {
  const openOrder = (packId = "starter-pack") => createPackOrder(deps, user, { packId, idempotencyKey: randomUUID() });
  const paymentRow = async (razorpayPaymentId: string) =>
    (await pg.query<{ status: string; credits_granted: number; grant_id: string | null }>(
      "select status, credits_granted, grant_id from public.billing_payments where razorpay_payment_id = $1", [razorpayPaymentId])).rows[0];
  const orderStatus = async (razorpayOrderId: string) =>
    (await pg.query<{ status: string }>("select status from public.billing_orders where razorpay_order_id = $1", [razorpayOrderId])).rows[0]!.status;

  it("two Starter orders opened before either is paid: the first payment is granted, the second isn't", async () => {
    const first = await openOrder();
    const second = await openOrder(); // allowed: nothing paid yet
    const p1 = gateway.payOrder(first.orderId);
    const p2 = gateway.payOrder(second.orderId);

    expect((await verifyPackPayment(deps, user.id, p1.checkout)).status).toBe("confirmed");
    await expect(verifyPackPayment(deps, user.id, p2.checkout)).rejects.toSatisfy(isCode("conflict"));
    expect(await balance()).toBe(2 + 3);

    // The money is recorded (for the refund), with no credits, and the order stops being reconciled.
    expect(await paymentRow(p2.payment.id)).toEqual({ status: "captured", credits_granted: 0, grant_id: null });
    expect(await orderStatus(second.orderId)).toBe("paid");
    expect((await reconcileBilling(deps)).ordersConfirmed).toBe(0);

    // Webhooks for the second payment, including retries, grant nothing either.
    const w = webhook("payment.captured", { payment: p2.payment });
    expect((await send(w)).outcome).toBe("pack_first_purchase_conflict");
    expect((await send(webhook("order.paid", { payment: p2.payment }))).outcome).toBe("pack_first_purchase_conflict");
    expect((await send(w)).outcome).toBe("duplicate");
    expect(await balance()).toBe(2 + 3);
    await expectConsistent();
  });

  it("two Starter payments settling at once: exactly one is granted", async () => {
    const [a, b] = [await openOrder(), await openOrder()];
    const pa = gateway.payOrder(a.orderId);
    const pb = gateway.payOrder(b.orderId);
    const outcomes = (await Promise.all([send(webhook("payment.captured", { payment: pa.payment })), send(webhook("payment.captured", { payment: pb.payment }))]))
      .map((o) => o.outcome)
      .sort();
    expect(outcomes).toEqual(["pack_first_purchase_conflict", "pack_granted"]);
    expect(await balance()).toBe(2 + 3);
    await expectConsistent();
  });

  it("a Starter order paid after another pack was bought is not granted", async () => {
    const starter = await openOrder();
    await paidPack("solo"); // bought while the Starter order was still open
    const p = gateway.payOrder(starter.orderId);
    await expect(verifyPackPayment(deps, user.id, p.checkout)).rejects.toSatisfy(isCode("conflict"));
    expect(await balance()).toBe(2 + 20);
  });

  it("a late duplicate for a Starter Pack that was granted stays 'already granted', even after later purchases", async () => {
    const starter = await openOrder();
    const p = gateway.payOrder(starter.orderId);
    await verifyPackPayment(deps, user.id, p.checkout);
    await paidPack("solo");
    expect((await send(webhook("payment.captured", { payment: p.payment }))).outcome).toBe("pack_already_granted");
    expect((await verifyPackPayment(deps, user.id, p.checkout)).status).toBe("confirmed");
    expect(await balance()).toBe(2 + 3 + 20);
    await expectConsistent();
  });

  it("other packs are unaffected: buying two Solo packs grants both", async () => {
    await paidPack("solo");
    await paidPack("solo");
    expect(await balance()).toBe(2 + 40);
  });
});

/* =============================================================== logging */

describe("payment error logging", () => {
  function captureConsole() {
    const lines: { level: string; line: Record<string, unknown> }[] = [];
    for (const level of ["error", "warn", "info", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((msg: unknown) => {
        try {
          lines.push({ level, line: JSON.parse(String(msg)) as Record<string, unknown> });
        } catch {
          lines.push({ level, line: { raw: String(msg) } });
        }
      });
    }
    return lines;
  }
  const levelOf = (lines: ReturnType<typeof captureConsole>, event: string) => lines.find((l) => l.line.event === event)?.level;

  it("classifies payment problems as errors and transient ones as warnings", () => {
    for (const e of ["billing.pack_payment_mismatch", "billing.webhook_failed", "billing.webhook_bad_signature", "billing.refund_shortfall", "billing.first_purchase_conflict", "billing.bad_checkout_signature"]) {
      expect(BILLING_ERROR_EVENTS.has(e), e).toBe(true);
      expect(billingLogLevel(e)).toBe("error");
    }
    expect(billingLogLevel("billing.verify_deferred")).toBe("warn");
    expect(billingLogLevel("billing.webhook_processed")).toBe("info");
  });

  it("logs a payment mismatch, bad signature, webhook failure, refund shortfall and Starter conflict at error level", async () => {
    const lines = captureConsole();
    const logged = { ...deps, log: billingLog };

    // Mismatch: Razorpay reports a different amount for our order.
    const o1 = await createPackOrder(logged, user, { packId: "solo", idempotencyKey: randomUUID() });
    const bad = gateway.payOrder(o1.orderId, { amount: 100 });
    await send(webhook("payment.captured", { payment: bad.payment }), logged);
    expect(levelOf(lines, "billing.pack_payment_mismatch")).toBe("error");

    // Forged webhook.
    const forged = webhook("payment.captured", { payment: bad.payment }, { secret: "not-the-secret" });
    expect((await send(forged, logged)).status).toBe(400);
    expect(levelOf(lines, "billing.webhook_bad_signature")).toBe("error");

    // Webhook processing failure (database error inside the transaction).
    const o2 = await createPackOrder(logged, user, { packId: "solo", idempotencyKey: randomUUID() });
    const ok = gateway.payOrder(o2.orderId);
    const failing = { ...logged, repo: Object.assign(Object.create(Object.getPrototypeOf(deps.repo)), deps.repo, { withTx: async () => { throw new Error("db down at postgresql://u:pw@db.internal/x"); } }) };
    expect((await send(webhook("payment.captured", { payment: ok.payment }), failing)).status).toBe(500);
    expect(levelOf(lines, "billing.webhook_failed")).toBe("error");
    // The Razorpay event type is kept, without overwriting the log's own event name.
    expect(lines.find((l) => l.line.event === "billing.webhook_failed")!.line.eventType).toBe("payment.captured");

    // Refund shortfall: credits already spent.
    await send(webhook("payment.captured", { payment: ok.payment }), logged);
    await pg.query("update public.credit_grants set remaining = 0 where source = 'pack'");
    await pg.query("update public.credit_balances set balance = 2 where shop_id = $1", [shopId]);
    await send(webhook("refund.processed", { refund: { id: "rfnd_sf", payment_id: ok.payment.id, amount: ok.payment.amount, status: "processed" }, payment: { ...ok.payment, amount_refunded: ok.payment.amount } }), logged);
    expect(levelOf(lines, "billing.refund_shortfall")).toBe("error");

    // Starter Pack conflict (a second shop, so its first purchase is still open).
    const u2 = await createUser(pg);
    const other = { id: u2.userId, email: EMAIL };
    const a = await createPackOrder(logged, other, { packId: "starter-pack", idempotencyKey: randomUUID() });
    const b = await createPackOrder(logged, other, { packId: "starter-pack", idempotencyKey: randomUUID() });
    await send(webhook("payment.captured", { payment: gateway.payOrder(a.orderId).payment }), logged);
    await send(webhook("payment.captured", { payment: gateway.payOrder(b.orderId).payment }), logged);
    expect(levelOf(lines, "billing.first_purchase_conflict")).toBe("error");

    // Nothing personal or secret in any line.
    const all = JSON.stringify(lines);
    for (const s of [EMAIL, KEY_SECRET, WEBHOOK_SECRET, "pw@db.internal", "postgresql://"]) expect(all, s).not.toContain(s);
  });

  it("scrubs secrets and contact details from log values", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    billingLog("billing.webhook_failed", {
      error: new Error(`failed for ${EMAIL} at postgres://user:hunter2@host/db with rzp_live_ABCDEF123 and sk-abc123`),
      nested: { email: EMAIL },
      amountPaise: 149900,
      payment: "pay_ABC123",
    });
    const line = JSON.parse(String(err.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "billing.webhook_failed", level: "error", amountPaise: 149900, payment: "pay_ABC123" });
    const text = JSON.stringify(line);
    for (const s of [EMAIL, "hunter2", "rzp_live_ABCDEF123", "sk-abc123"]) expect(text).not.toContain(s);
  });
});

/* ================================================================ webhook */

describe("webhook body limits (POST /api/webhooks/razorpay)", () => {
  const URL_ = "https://aabhar.example/api/webhooks/razorpay";
  const MAX = 512 * 1024;
  const POST = async (req: Request) => (await import("@/app/api/webhooks/razorpay/route")).POST(req);
  const signed = (body: string | Uint8Array, extra: Record<string, string> = {}) => ({
    "x-razorpay-signature": hmacHex(WEBHOOK_SECRET, typeof body === "string" ? body : Buffer.from(body)),
    "x-razorpay-event-id": `evt_${randomUUID()}`,
    "content-type": "application/json",
    ...extra,
  });
  /** A body that records whether anything read it. */
  function watchedStream(bytes: Uint8Array) {
    const state = { pulled: false };
    // highWaterMark 0: the stream doesn't pull ahead of a reader, so `pulled` means someone read it.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          state.pulled = true;
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, state };
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("refuses a declared Content-Length over the limit without reading the body", async () => {
    const { stream, state } = watchedStream(new Uint8Array(10));
    const res = await POST(new Request(URL_, { method: "POST", body: stream, headers: { "content-length": String(MAX + 1) }, duplex: "half" } as RequestInit));
    expect(res.status).toBe(413);
    expect(state.pulled).toBe(false);
  });

  it("refuses a malformed Content-Length", async () => {
    for (const v of ["abc", "-1", "1e6", "12 34"]) {
      const res = await POST(new Request(URL_, { method: "POST", body: "{}", headers: { "content-length": v } }));
      expect(res.status, v).toBe(400);
    }
  });

  it("counts bytes, not characters: a body under the limit in characters but over it in bytes is refused", async () => {
    const body = `{"event":"x","pad":"${"₹".repeat(Math.ceil(MAX / 3) + 10)}"}`; // ₹ is 3 bytes in UTF-8
    expect(body.length).toBeLessThan(MAX);
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX);
    const res = await POST(new Request(URL_, { method: "POST", body, headers: signed(body) }));
    expect(res.status).toBe(413);
  });

  it("refuses an oversized streamed body with no Content-Length, as soon as it passes the limit", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
        if (sent > 4 * MAX) controller.close();
      },
    });
    const res = await POST(new Request(URL_, { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(MAX + 2 * 64 * 1024); // stopped early, didn't buffer it all
  });

  it("refuses a body that isn't valid UTF-8", async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const res = await POST(new Request(URL_, { method: "POST", body: bytes, headers: signed(bytes) }));
    expect(res.status).toBe(400);
  });

  it("still verifies the HMAC over the exact raw body: a re-serialised body is refused", async () => {
    const w = webhook("payment.captured", { payment: { id: "pay_x", order_id: "order_x", amount: 1, currency: "INR", status: "captured" } });
    const reserialised = JSON.stringify(JSON.parse(w.body), null, 2);
    const res = await POST(new Request(URL_, { method: "POST", body: reserialised, headers: { "x-razorpay-signature": w.headers.signature, "x-razorpay-event-id": w.headers.eventId } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ outcome: "bad_signature" });
  });

  it("accepts a correctly signed body with multi-byte characters at its declared length, and processes a payment once", async () => {
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment: { ...payment, notes: { label: "सोलो ₹ pack" } } });
    const headers = { "x-razorpay-signature": w.headers.signature, "x-razorpay-event-id": w.headers.eventId, "content-length": String(Buffer.byteLength(w.body)) };

    const first = await POST(new Request(URL_, { method: "POST", body: w.body, headers }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ outcome: "pack_granted" });
    expect(await balance()).toBe(2 + 20);

    // Razorpay retries the same event: nothing more.
    const again = await POST(new Request(URL_, { method: "POST", body: w.body, headers }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ outcome: "duplicate" });
    expect(await balance()).toBe(2 + 20);
  });
});

/* ========================================================= admin health */

describe("admin billing health", () => {
  async function adminCtx() {
    const a = await makeAdmin(pg, "support");
    return requireAdmin(db, { id: a.userId, email: a.email }, "read");
  }
  const adminDeps = (extra: { paymentsEnabled?: boolean; webhookSecretConfigured?: boolean } = {}) => ({ ...testAdminDeps(db), ...extra });

  it("reports webhook, unpaid-order and reconciliation state without payloads or contact details", async () => {
    const ctx = await adminCtx();
    // A processed event, a failing one and one not processed yet.
    const order = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    const { payment } = gateway.payOrder(order.orderId);
    await send(webhook("payment.captured", { payment: { ...payment, email: EMAIL, contact: "+919999999999" } }));
    await pg.query(
      `insert into public.billing_webhook_events (event_id, event_type, mode, payload, last_error) values
         ('evt_failing', 'payment.captured', 'test', $1, 'db error'), ('evt_pending', 'refund.processed', 'test', $1, null)`,
      [JSON.stringify({ payload: { payment: { entity: { email: EMAIL } } } })],
    );
    // Two unpaid orders: one two hours old, one four days old; one fresh (not counted).
    const stale = await createPackOrder(deps, user, { packId: "signature", idempotencyKey: randomUUID() });
    const old = await createPackOrder(deps, user, { packId: "studio", idempotencyKey: randomUUID() });
    await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    await pg.query("update public.billing_orders set created_at = now() - interval '2 hours' where razorpay_order_id = $1", [stale.orderId]);
    await pg.query("update public.billing_orders set created_at = now() - interval '4 days' where razorpay_order_id = $1", [old.orderId]);
    await reconcileBilling(deps);

    const h = await getBillingHealth(adminDeps({ paymentsEnabled: true, webhookSecretConfigured: true }), ctx);
    expect(h).toMatchObject({ paymentsEnabled: true, mode: "test", webhookSecretConfigured: true });
    expect(h.lastProcessedWebhook).toMatchObject({ eventType: "payment.captured", outcome: "pack_granted" });
    expect(h.webhooks).toMatchObject({ pending: 1, failed: 1 });
    expect(h.webhooks.oldestUnprocessedAt).not.toBeNull();
    expect(h.unpaidOrders.olderThanOneHour).toBe(2);
    expect(h.unpaidOrders.withinReconcileWindow).toBe(1);
    expect(h.unpaidOrders.recent.map((o) => o.razorpayOrderId)).toEqual([stale.orderId, old.orderId]);
    expect(h.lastReconcileRun).toMatchObject({ ok: true, ordersChecked: 1, ordersConfirmed: 0, ordersFailed: 0, error: null });

    const text = JSON.stringify(h);
    for (const s of [EMAIL, "+919999999999", KEY_SECRET, WEBHOOK_SECRET]) expect(text).not.toContain(s);
  });

  it("says no when the webhook secret or payments aren't configured, and handles an empty database", async () => {
    const h = await getBillingHealth(adminDeps(), await adminCtx());
    expect(h).toMatchObject({
      paymentsEnabled: false,
      webhookSecretConfigured: false,
      lastProcessedWebhook: null,
      webhooks: { pending: 0, failed: 0, oldestUnprocessedAt: null },
      unpaidOrders: { olderThanOneHour: 0, withinReconcileWindow: 0, recent: [] },
      lastReconcileRun: null,
    });
  });

  it("records a failed reconciliation run, and still runs (unrecorded) before the migration is applied", async () => {
    const ctx = await adminCtx();
    const failing = { ...deps, gateway: Object.assign(Object.create(FakeGateway.prototype), gateway, { fetchOrderPayments: async () => { throw new Error("Razorpay unreachable"); } }) };
    const o = await createPackOrder(deps, user, { packId: "solo", idempotencyKey: randomUUID() });
    await pg.query("update public.billing_orders set created_at = now() - interval '2 hours' where razorpay_order_id = $1", [o.orderId]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await reconcileBilling({ ...failing, log: billingLog });
    expect((await getBillingHealth(adminDeps(), ctx)).lastReconcileRun).toMatchObject({ ok: false, ordersChecked: 1, ordersFailed: 1 });

    await pg.query("drop table public.billing_reconcile_runs");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(reconcileBilling({ ...deps, log: billingLog })).resolves.toMatchObject({ ordersConfirmed: 0 });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("billing.reconcile_run_not_recorded"))).toBe(true);
    expect((await getBillingHealth(adminDeps(), ctx)).lastReconcileRun).toBe("unavailable");
  });
});

import { createHmac, randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { billingConfig, paidPlans } from "@/config/billing";
import type { BillingAvailability } from "@/lib/billing-types";
import { BillingRepository } from "@/server/billing/repository";
import { createPackOrder, handleRazorpayWebhook, verifyPackPayment, type BillingDeps } from "@/server/billing/service";
import { GatewayError } from "@/server/billing/gateway";
import { verifyOrderPaymentSignature, verifyWebhookSignature } from "@/server/billing/signature";
import { DomainError } from "@/server/generation/domain-error";
import type { Db } from "@/server/db/sql";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhook } from "../support/fake-gateway";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Razorpay checkout and webhook security, against the real billing SQL
 * (PGlite) and a fake Razorpay with real HMAC signatures. Complements
 * billing-service.test.ts (which already covers forged signatures, amount
 * mismatch, ownership, capture-before-grant, duplicate/replayed webhooks).
 */

let pg: PGlite;
let db: Db;
let gateway: FakeGateway;
let deps: BillingDeps;
let logs: { event: string; data: Record<string, unknown> }[];
let user: { id: string; email: string | null };
let shopId: string;

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
  logs = [];
  deps = {
    repo,
    gateway,
    availability,
    config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" },
    log: (event, data) => logs.push({ event, data }),
  };
  const u = await createUser(pg);
  user = { id: u.userId, email: "owner@example.test" };
  shopId = u.shopId;
}, 60_000);

const TRIAL = billingConfig.trial.credits;
const balance = () => deps.repo.balance(shopId);
const send = (w: { body: string; headers: { signature: string | null; eventId: string | null } }) => handleRazorpayWebhook(deps, w.body, w.headers);
const newOrder = (packId = "solo") => createPackOrder(deps, user, { packId, idempotencyKey: randomUUID() });
const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

async function packGrantsFor(razorpayOrderId: string) {
  const { rows } = await pg.query<{ n: number; s: number }>(
    "select count(*)::int as n, coalesce(sum(amount),0)::int as s from public.credit_grants where idempotency_key = $1",
    [`grant:order:${razorpayOrderId}`],
  );
  return rows[0]!;
}

async function expectConsistent() {
  const b = await balance();
  const ledger = await pg.query<{ s: number }>("select coalesce(sum(amount),0)::int as s from public.credit_ledger where shop_id = $1", [shopId]);
  const grants = await pg.query<{ s: number }>("select coalesce(sum(remaining),0)::int as s from public.credit_grants where shop_id = $1", [shopId]);
  expect(ledger.rows[0]!.s).toBe(b);
  expect(grants.rows[0]!.s).toBe(b);
}

describe("checkout signature (HMAC-SHA256 of order_id|payment_id with the key secret)", () => {
  it("accepts exactly Razorpay's documented signature and nothing else", () => {
    const sig = hmac(KEY_SECRET, "order_ABC|pay_XYZ");
    expect(verifyOrderPaymentSignature("order_ABC", "pay_XYZ", sig, KEY_SECRET)).toBe(true);
    expect(verifyOrderPaymentSignature("order_ABC", "pay_XYZ", sig.toUpperCase(), KEY_SECRET)).toBe(true); // hex case-insensitive
    expect(verifyOrderPaymentSignature("order_ABC", "pay_XYZ", hmac(WEBHOOK_SECRET, "order_ABC|pay_XYZ"), KEY_SECRET)).toBe(false); // wrong secret
    expect(verifyOrderPaymentSignature("order_ABC", "pay_OTHER", sig, KEY_SECRET)).toBe(false);
    expect(verifyOrderPaymentSignature("order_ABC", "pay_XYZ", sig.slice(0, 63), KEY_SECRET)).toBe(false); // truncated
    for (const missing of ["", "not-hex", "g".repeat(64)]) expect(verifyOrderPaymentSignature("order_ABC", "pay_XYZ", missing, KEY_SECRET)).toBe(false);
  });

  it("valid signature for a captured payment grants the pack's credits once", async () => {
    const order = await newOrder("signature");
    const { checkout } = gateway.payOrder(order.orderId);
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "confirmed", creditsGranted: 75, balance: TRIAL + 75 });
    await expectConsistent();
  });

  it("missing signature is rejected and grants nothing", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    await expectCode(verifyPackPayment(deps, user.id, { ...checkout, razorpay_signature: "" }), "payment_failed");
    expect(await balance()).toBe(TRIAL);
  });

  it("a valid signature can't be replayed against a different order", async () => {
    const a = await newOrder();
    const b = await newOrder("signature");
    const { checkout } = gateway.payOrder(a.orderId);
    await expectCode(verifyPackPayment(deps, user.id, { ...checkout, razorpay_order_id: b.orderId }), "payment_failed");
    await expectCode(verifyPackPayment(deps, user.id, { ...checkout, razorpay_order_id: "order_DoesNotExist1" }), "not_found");
    expect(await balance()).toBe(TRIAL);
  });

  it("a payment for another customer's order is refused, even with a valid signature", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    const other = await createUser(pg);
    await expectCode(verifyPackPayment(deps, other.userId, checkout), "not_found");
    expect(await deps.repo.balance(other.shopId)).toBe(TRIAL);
    expect(await balance()).toBe(TRIAL);
  });

  it("currency mismatch is refused by verify and by the webhook", async () => {
    const order = await newOrder();
    const { checkout, payment } = gateway.payOrder(order.orderId);
    gateway.payments.get(payment.id)!.currency = "USD";
    await expectCode(verifyPackPayment(deps, user.id, checkout), "payment_failed");
    expect((await send(webhook("payment.captured", { payment: gateway.payments.get(payment.id) }))).outcome).toBe("pack_mismatch");
    expect(await balance()).toBe(TRIAL);
  });

  it("the client can't choose the amount, credits or currency: the order uses the server's pack config", async () => {
    const order = await newOrder("studio");
    expect(order.checkout).toMatchObject({ amount: 1_999_900, currency: "INR", order_id: order.orderId, key: KEY_ID });
    expect(gateway.orders.get(order.orderId)).toMatchObject({ amount: 1_999_900, currency: "INR" });
    await expectCode(createPackOrder(deps, user, { packId: "studio-but-cheaper", idempotencyKey: randomUUID() }), "invalid_request");
  });
});

describe("webhook signature (HMAC-SHA256 of the raw body with the webhook secret)", () => {
  it("accepts a correctly signed raw body", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment });
    expect(verifyWebhookSignature(w.body, w.headers.signature, WEBHOOK_SECRET)).toBe(true);
    expect(await send(w)).toEqual({ status: 200, outcome: "pack_granted" });
  });

  it("rejects a missing signature header, a body signed with the API key secret, and a re-serialised body", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment });
    expect(await send({ body: w.body, headers: { ...w.headers, signature: null } })).toEqual({ status: 400, outcome: "bad_signature" });
    expect(await send({ body: w.body, headers: { ...w.headers, signature: hmac(KEY_SECRET, w.body) } })).toEqual({ status: 400, outcome: "bad_signature" });
    // Same JSON, different bytes (whitespace): the signature covers the raw bytes, so this must fail.
    const reserialised = JSON.stringify(JSON.parse(w.body), null, 1);
    expect(await send({ body: reserialised, headers: w.headers })).toEqual({ status: 400, outcome: "bad_signature" });
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.billing_webhook_events");
    expect(rows[0]!.n).toBe(0);
    expect(await balance()).toBe(TRIAL);
  });

  it("rejects malformed JSON and an envelope without an event type, even when correctly signed", async () => {
    const bad = "{not json";
    expect(await send({ body: bad, headers: { signature: hmac(WEBHOOK_SECRET, bad), eventId: "evt_badjson" } })).toEqual({ status: 400, outcome: "bad_json" });
    const noEvent = JSON.stringify({ payload: {} });
    expect(await send({ body: noEvent, headers: { signature: hmac(WEBHOOK_SECRET, noEvent), eventId: "evt_noevent" } })).toEqual({ status: 400, outcome: "bad_event" });
  });

  it("answers 503 (so Razorpay retries) when the webhook secret isn't configured", async () => {
    const w = webhook("payment.captured", { payment: { id: "pay_x" } });
    expect(await handleRazorpayWebhook({ ...deps, config: { ...deps.config!, webhookSecret: "" } }, w.body, w.headers)).toEqual({ status: 503, outcome: "not_configured" });
  });
});

describe("which payment states grant credits", () => {
  it("a failed payment grants nothing, is recorded as failed, and a late 'failed' can't undo a capture", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId, { status: "failed" });
    expect((await send(webhook("payment.failed", { payment }))).outcome).toBe("pack_not_captured");
    expect(await balance()).toBe(TRIAL);
    expect((await deps.repo.paymentByRazorpayId(payment.id))?.status).toBe("failed");

    const paid = await newOrder();
    const { checkout, payment: p2 } = gateway.payOrder(paid.orderId);
    await verifyPackPayment(deps, user.id, checkout);
    // The late event is answered 200 and changes nothing (its outcome label reflects the event's own status).
    expect(await send(webhook("payment.failed", { payment: { ...p2, status: "failed" } }))).toEqual({ status: 200, outcome: "pack_not_captured" });
    expect((await deps.repo.paymentByRazorpayId(p2.id))?.status).toBe("captured");
    expect(await balance()).toBe(TRIAL + 20);
  });

  it("an authorized payment that can't be captured grants nothing until it's captured", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId, { status: "authorized" });
    const realCapture = gateway.capturePayment.bind(gateway);
    gateway.capturePayment = async () => {
      throw new Error("capture temporarily unavailable");
    };
    // Still authorized after the attempt: not known to be paid, so answer 500 and let Razorpay retry.
    const w = webhook("payment.authorized", { payment });
    expect(await send(w)).toEqual({ status: 500, outcome: "error" });
    expect(await balance()).toBe(TRIAL);

    gateway.capturePayment = realCapture;
    expect((await send(w)).outcome).toBe("pack_granted"); // Razorpay's retry of the same event
    expect(await balance()).toBe(TRIAL + 20);
  });

  it("a captured payment grants the pack's credits", async () => {
    const order = await newOrder("studio");
    const { payment } = gateway.payOrder(order.orderId);
    expect((await send(webhook("order.paid", { payment, order: gateway.orders.get(order.orderId) }))).outcome).toBe("pack_granted");
    expect(await balance()).toBe(TRIAL + 500);
  });
});

describe("exactly-once credits", () => {
  it("verify and webhook arriving together grant once", async () => {
    const order = await newOrder();
    const { checkout, payment } = gateway.payOrder(order.orderId);
    const [v, w1, w2] = await Promise.all([
      verifyPackPayment(deps, user.id, checkout),
      send(webhook("payment.captured", { payment })),
      send(webhook("order.paid", { payment, order: gateway.orders.get(order.orderId) })),
    ]);
    const granted = [v.creditsGranted === 20, w1.outcome === "pack_granted", w2.outcome === "pack_granted"].filter(Boolean);
    expect(granted).toHaveLength(1);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
    expect(await balance()).toBe(TRIAL + 20);
    await expectConsistent();
  });

  it("repeated verification (refreshing the success page) grants once", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await verifyPackPayment(deps, user.id, checkout));
    expect(results.map((r) => r.creditsGranted)).toEqual([20, 0, 0, 0]);
    expect(results.every((r) => r.status === "confirmed")).toBe(true);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("a duplicate webhook event (same event id) is processed once", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment }, { eventId: "evt_dup" });
    expect((await send(w)).outcome).toBe("pack_granted");
    expect((await send(w)).outcome).toBe("duplicate");
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });
});

describe("database failures", () => {
  /** Makes the next N transactions fail as if the database connection dropped. */
  function failNextTransactions(n: number) {
    const repo = deps.repo as BillingRepository & { withTx: BillingRepository["withTx"] };
    const real = repo.withTx.bind(repo);
    let left = n;
    repo.withTx = ((fn: Parameters<BillingRepository["withTx"]>[0]) =>
      left-- > 0 ? Promise.reject(new Error("Connection terminated unexpectedly")) : real(fn)) as BillingRepository["withTx"];
  }

  it("a webhook that hits a database error answers 500 (Razorpay retries) and the retry grants once", async () => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId);
    const w = webhook("payment.captured", { payment }, { eventId: "evt_retry" });
    failNextTransactions(1);
    expect(await send(w)).toEqual({ status: 500, outcome: "error" });
    expect(await balance()).toBe(TRIAL);
    const { rows } = await pg.query<{ processed: boolean; err: string | null }>(
      "select processed_at is not null as processed, last_error as err from public.billing_webhook_events where event_id = 'evt_retry'",
    );
    expect(rows[0]).toMatchObject({ processed: false });
    expect(rows[0]!.err).toContain("Connection terminated");

    expect((await send(w)).outcome).toBe("pack_granted");
    expect((await send(w)).outcome).toBe("duplicate");
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("verify that hits a database error reports 'pending' instead of failing, and the webhook completes it once", async () => {
    const order = await newOrder();
    const { checkout, payment } = gateway.payOrder(order.orderId);
    failNextTransactions(1);
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "pending", creditsGranted: 0 });
    expect(logs.map((l) => l.event)).toContain("billing.verify_deferred");
    expect((await send(webhook("payment.captured", { payment }))).outcome).toBe("pack_granted");
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "confirmed", creditsGranted: 0, balance: TRIAL + 20 });
  });

  it("a retry after a committed-but-unacknowledged verify grants nothing more", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    await verifyPackPayment(deps, user.id, checkout); // committed; pretend the response was lost
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "confirmed", creditsGranted: 0, balance: TRIAL + 20 });
  });
});

describe("capture happens outside the database transaction (recommendation 1)", () => {
  /** Records every Razorpay call and whether a billing transaction was open at that moment. */
  function instrument() {
    const events: string[] = [];
    let openTx = 0;
    const repo = deps.repo as BillingRepository;
    const realTx = repo.withTx.bind(repo);
    repo.withTx = (async (fn: Parameters<BillingRepository["withTx"]>[0]) => {
      openTx++;
      events.push("tx:open");
      try {
        return await realTx(fn);
      } finally {
        openTx--;
        events.push("tx:close");
      }
    }) as BillingRepository["withTx"];
    for (const name of ["capturePayment", "fetchPayment"] as const) {
      const real = gateway[name].bind(gateway) as (...a: unknown[]) => Promise<unknown>;
      (gateway as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
        events.push(`${name}${openTx ? ":INSIDE_TX" : ""}`);
        return real(...a);
      };
    }
    return events;
  }

  const authorizedWebhook = async (opts: { eventId?: string } = {}) => {
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId, { status: "authorized" });
    return { order, payment, w: webhook("payment.authorized", { payment }, opts) };
  };
  const eventRow = async (eventId: string) =>
    (
      await pg.query<{ processed: boolean; err: string | null }>(
        "select processed_at is not null as processed, last_error as err from public.billing_webhook_events where event_id = $1",
        [eventId],
      )
    ).rows[0];

  it("1. captures and re-fetches before the transaction opens; nothing calls Razorpay inside it", async () => {
    const { order, w } = await authorizedWebhook();
    const events = instrument();
    expect((await send(w)).outcome).toBe("pack_granted");
    expect(events).toEqual(["capturePayment", "fetchPayment", "tx:open", "tx:close"]);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("2. capture failure grants nothing and leaves the event unprocessed for Razorpay to retry", async () => {
    const { w } = await authorizedWebhook({ eventId: "evt_capfail" });
    gateway.capturePayment = async () => {
      throw new Error("BAD_REQUEST_ERROR: capture refused");
    };
    expect(await send(w)).toEqual({ status: 500, outcome: "error" });
    expect(await balance()).toBe(TRIAL);
    const row = await eventRow("evt_capfail");
    expect(row).toMatchObject({ processed: false });
    expect(row!.err).toMatch(/still authorized/);
    expect(logs.map((l) => l.event)).toContain("billing.webhook_failed");
  });

  it("3a. a capture that times out after Razorpay captured is confirmed by the re-fetch and granted once", async () => {
    const { order, payment, w } = await authorizedWebhook();
    const realCapture = gateway.capturePayment.bind(gateway);
    gateway.capturePayment = async (id: string, amount: number) => {
      await realCapture(id, amount); // Razorpay did capture…
      throw new Error("Payment gateway didn't answer within 20s"); // …but our call timed out
    };
    expect((await send(w)).outcome).toBe("pack_granted");
    expect(gateway.payments.get(payment.id)!.status).toBe("captured");
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("3b. a timeout with Razorpay unreachable is retried safely and grants once", async () => {
    const { order, w } = await authorizedWebhook({ eventId: "evt_timeout" });
    gateway.down = true;
    expect(await send(w)).toEqual({ status: 500, outcome: "error" });
    expect(await eventRow("evt_timeout")).toMatchObject({ processed: false });
    expect(await balance()).toBe(TRIAL);
    gateway.down = false;
    expect((await send(w)).outcome).toBe("pack_granted"); // Razorpay's retry
    expect((await send(w)).outcome).toBe("duplicate");
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("4. an already-captured payment (capture refused as 'already captured') grants once, and later events add nothing", async () => {
    const { order, payment, w } = await authorizedWebhook();
    await gateway.capturePayment(payment.id, payment.amount); // captured elsewhere first
    gateway.capturePayment = async () => {
      throw new GatewayError("This payment has already been captured", 400, "BAD_REQUEST_ERROR");
    };
    expect((await send(w)).outcome).toBe("pack_granted");
    expect((await send(webhook("payment.captured", { payment: gateway.payments.get(payment.id) }))).outcome).toBe("pack_already_granted");
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
    await expectConsistent();
  });

  it("5. concurrent authorized events for one payment grant once", async () => {
    const { order, payment } = await authorizedWebhook();
    const results = await Promise.all([
      send(webhook("payment.authorized", { payment })),
      send(webhook("payment.authorized", { payment })),
      send(webhook("order.paid", { payment, order: gateway.orders.get(order.orderId) })),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.outcome === "pack_granted")).toHaveLength(1);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
    await expectConsistent();
  });

  it("6. a duplicate delivery of the same event is idempotent and doesn't call Razorpay again", async () => {
    const { order, w } = await authorizedWebhook({ eventId: "evt_authdup" });
    expect((await send(w)).outcome).toBe("pack_granted");
    const events = instrument();
    expect((await send(w)).outcome).toBe("duplicate");
    expect(events.filter((e) => e.startsWith("capturePayment") || e.startsWith("fetchPayment"))).toEqual([]);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 1, s: 20 });
  });

  it("9. captured payments behave as before: no capture or fetch, credits granted, verify confirms", async () => {
    const order = await newOrder();
    const { payment, checkout } = gateway.payOrder(order.orderId);
    const events = instrument();
    expect((await send(webhook("payment.captured", { payment }))).outcome).toBe("pack_granted");
    expect(events).toEqual(["tx:open", "tx:close"]);
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "confirmed", creditsGranted: 0, balance: TRIAL + 20 });
  });

  it("verify also captures outside the transaction", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId, { status: "authorized" });
    const events = instrument();
    expect(await verifyPackPayment(deps, user.id, checkout)).toMatchObject({ status: "confirmed", creditsGranted: 20 });
    expect(events).toEqual(["fetchPayment", "capturePayment", "fetchPayment", "tx:open", "tx:close"]);
  });
});

describe("verify reports Razorpay's real status (recommendation 2)", () => {
  it("7. a payment Razorpay confirms as failed returns 'failed' with the usual response shape", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId, { status: "failed" });
    const r = await verifyPackPayment(deps, user.id, checkout);
    expect(r).toEqual({ status: "failed", creditsGranted: 0, balance: TRIAL });
  });

  it("8. failed payments never grant credits, by verify or webhook, however often they're retried", async () => {
    const order = await newOrder();
    const { checkout, payment } = gateway.payOrder(order.orderId, { status: "failed" });
    for (let i = 0; i < 3; i++) expect((await verifyPackPayment(deps, user.id, checkout)).status).toBe("failed");
    expect((await send(webhook("payment.failed", { payment }))).outcome).toBe("pack_not_captured");
    expect(await balance()).toBe(TRIAL);
    expect(await packGrantsFor(order.orderId)).toEqual({ n: 0, s: 0 });
  });

  it("authorized (not yet capturable) and created payments stay 'pending', not 'failed'", async () => {
    const a = await newOrder();
    const { checkout } = gateway.payOrder(a.orderId, { status: "authorized" });
    gateway.capturePayment = async () => {
      throw new Error("capture temporarily unavailable");
    };
    expect((await verifyPackPayment(deps, user.id, checkout)).status).toBe("pending");

    const b = await newOrder();
    const { checkout: c2, payment } = gateway.payOrder(b.orderId);
    gateway.payments.get(payment.id)!.status = "created";
    expect((await verifyPackPayment(deps, user.id, c2)).status).toBe("pending");
    expect(await balance()).toBe(TRIAL);
  });

  it("Razorpay unreachable during verify is 'pending' (not 'failed')", async () => {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    gateway.down = true;
    expect((await verifyPackPayment(deps, user.id, checkout)).status).toBe("pending");
  });
});

describe("database-level protection (holds even if application checks fail)", () => {
  async function paidPackPayment() {
    const order = await newOrder();
    const { checkout } = gateway.payOrder(order.orderId);
    await verifyPackPayment(deps, user.id, checkout);
    const payment = (await deps.repo.paymentByRazorpayId(checkout.razorpay_payment_id))!;
    return { order, payment };
  }
  const grantDirect = (paymentRowId: string, key: string) =>
    pg.query<{ id: string | null }>(
      "select public.grant_credits($1, 20, 'pack', now() + interval '365 days', $2, 'direct call', null, $3) as id",
      [shopId, key, paymentRowId],
    );

  it("rejects a second webhook event row, payment row or order row with the same Razorpay id", async () => {
    await pg.query("insert into public.billing_webhook_events (event_id, event_type, mode, payload) values ('evt_u', 'payment.captured', 'test', '{}')");
    await expect(pg.query("insert into public.billing_webhook_events (event_id, event_type, mode, payload) values ('evt_u', 'payment.captured', 'test', '{}')")).rejects.toThrow(/duplicate key|unique/i);

    const { order, payment } = await paidPackPayment();
    await expect(
      pg.query(
        "insert into public.billing_payments (shop_id, razorpay_payment_id, kind, order_id, amount_paise, currency, status, description) select $1, $2, 'pack', id, 149900, 'INR', 'captured', 'dup' from public.billing_orders where razorpay_order_id = $3",
        [shopId, payment.razorpayPaymentId, order.orderId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      pg.query(
        "insert into public.billing_orders (shop_id, pack_id, credits, validity_days, amount_paise, mode, razorpay_order_id, idempotency_key, created_by) select shop_id, pack_id, credits, validity_days, amount_paise, mode, razorpay_order_id, gen_random_uuid()::text, created_by from public.billing_orders where razorpay_order_id = $1",
        [order.orderId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("grant_credits called directly with the same key grants once (database idempotency)", async () => {
    const { order, payment } = await paidPackPayment();
    const again = await grantDirect(payment.id, `grant:order:${order.orderId}`);
    expect(again.rows[0]!.id).toBeNull();
    expect(await balance()).toBe(TRIAL + 20);
    await expectConsistent();
  });

  it("the migration creates the partial unique index on paid grants only", async () => {
    const { rows } = await pg.query<{ def: string }>(
      "select indexdef as def from pg_indexes where schemaname = 'public' and indexname = 'credit_grants_one_paid_grant_per_payment'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.def).toMatch(/UNIQUE INDEX .* ON public\.credit_grants .*\(payment_id\) WHERE \(\(payment_id IS NOT NULL\) AND \(source = ANY \(ARRAY\['pack'::text, 'plan'::text\]\)\)\)/);
  });

  it("two different idempotency keys for one payment: the first grants, the second is rejected", async () => {
    // A recorded payment with no grant yet (a failed attempt), granted directly under two keys.
    const order = await newOrder();
    const { payment } = gateway.payOrder(order.orderId, { status: "failed" });
    await send(webhook("payment.failed", { payment }));
    const row = (await deps.repo.paymentByRazorpayId(payment.id))!;
    expect((await grantDirect(row.id, "grant:path-a:1")).rows[0]!.id).not.toBeNull();
    await expect(grantDirect(row.id, "grant:path-b:2")).rejects.toThrow(/duplicate key|unique/i);
    expect(await balance()).toBe(TRIAL + 20);
    await expectConsistent();
  });

  it("a second grant for an already-credited payment under a different key is rejected, and nothing changes", async () => {
    const { payment } = await paidPackPayment();
    await expect(grantDirect(payment.id, "grant:buggy-path:other-key")).rejects.toThrow(/duplicate key|unique/i);
    expect(await balance()).toBe(TRIAL + 20);
    await expectConsistent();
  });

  it("covers plan (subscription) grants too: one paid grant per payment in total, whichever paid source", async () => {
    const planGrant = (paymentId: string, key: string) =>
      pg.query("select public.grant_credits($1, 5, 'plan', now() + interval '30 days', $2, 'plan grant', null, $3)", [shopId, key, paymentId]);
    // A payment already credited as a pack can't also be credited as a plan.
    const { payment: packPayment } = await paidPackPayment();
    await expect(planGrant(packPayment.id, "grant:subpay:test-0")).rejects.toThrow(/duplicate key|unique/i);

    // Two recorded payments with no grant yet: each gets exactly one plan grant.
    const rows = [];
    for (let i = 0; i < 2; i++) {
      const order = await newOrder();
      const { payment } = gateway.payOrder(order.orderId, { status: "failed" });
      await send(webhook("payment.failed", { payment }));
      rows.push((await deps.repo.paymentByRazorpayId(payment.id))!);
    }
    await planGrant(rows[0]!.id, "grant:subpay:a-1");
    await planGrant(rows[1]!.id, "grant:subpay:b-1"); // a different payment: allowed
    await expect(planGrant(rows[0]!.id, "grant:subpay:a-2")).rejects.toThrow(/duplicate key|unique/i);
    expect(await balance()).toBe(TRIAL + 20 + 5 + 5);
    await expectConsistent();
  });

  it("free, promotional, referral, legacy and refund grants are unaffected (no payment, or not a paid source)", async () => {
    const { payment } = await paidPackPayment();
    const grant = (source: string, key: string, paymentId: string | null = null) =>
      pg.query<{ id: string | null }>("select public.grant_credits($1, 3, $2, null, $3, 'unaffected', null, $4) as id", [shopId, source, key, paymentId]);
    // Trial credits were granted at sign-up by the database trigger.
    const trial = await pg.query<{ n: number }>("select count(*)::int as n from public.credit_grants where shop_id = $1 and source = 'trial'", [shopId]);
    expect(trial.rows[0]!.n).toBe(1);
    // Several of each, none tied to a payment: all accepted.
    for (const [source, n] of [["admin", 3], ["referral", 2], ["legacy", 1], ["refund_restore", 2], ["refund_request", 2]] as const) {
      for (let i = 0; i < n; i++) expect((await grant(source, `${source}:${i}`)).rows[0]!.id, `${source} #${i}`).not.toBeNull();
    }
    // Even non-paid sources that reference the same payment stay outside the index.
    expect((await grant("referral", "referral:with-payment:1", payment.id)).rows[0]!.id).not.toBeNull();
    expect((await grant("referral", "referral:with-payment:2", payment.id)).rows[0]!.id).not.toBeNull();
    expect(await balance()).toBe(TRIAL + 20 + 3 * (3 + 2 + 1 + 2 + 2 + 2));
    await expectConsistent();
  });

  it("normal purchases and duplicate deliveries work as before with the index in place", async () => {
    const a = await newOrder("solo");
    const { checkout, payment } = gateway.payOrder(a.orderId);
    const [v, w] = await Promise.all([verifyPackPayment(deps, user.id, checkout), send(webhook("payment.captured", { payment }))]);
    expect([v.creditsGranted === 20, w.outcome === "pack_granted"].filter(Boolean)).toHaveLength(1); // exactly one of them grants
    const b = await newOrder("signature");
    const { checkout: c2 } = gateway.payOrder(b.orderId);
    expect((await verifyPackPayment(deps, user.id, c2)).creditsGranted).toBe(75);
    expect(await balance()).toBe(TRIAL + 20 + 75);
    await expectConsistent();
  });
});

describe("secrets", () => {
  it("never appear in checkout responses, webhook responses or logs", async () => {
    const order = await newOrder();
    const { checkout, payment } = gateway.payOrder(order.orderId);
    const outputs = [
      order,
      await verifyPackPayment(deps, user.id, { ...checkout, razorpay_signature: "0".repeat(64) }).catch((e: unknown) => String(e)),
      await verifyPackPayment(deps, user.id, checkout),
      await send(webhook("payment.captured", { payment })),
      await send({ body: "{}", headers: { signature: "bad", eventId: "evt_bad" } }),
    ];
    const text = JSON.stringify({ outputs, logs });
    for (const secret of [KEY_SECRET, WEBHOOK_SECRET, checkout.razorpay_signature]) expect(text).not.toContain(secret);
  });
});

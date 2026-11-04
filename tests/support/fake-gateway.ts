import { randomBytes } from "node:crypto";

import {
  GatewayError,
  type GatewayOrder,
  type GatewayPayment,
  type GatewaySubscription,
  type PaymentGateway,
} from "@/server/billing/gateway";
import { hmacHex } from "@/server/billing/signature";

/**
 * In-memory stand-in for Razorpay. Tests drive it like the Razorpay
 * Dashboard would: mark payments captured or failed, advance subscriptions,
 * and emit correctly signed webhooks.
 */
export const KEY_ID = "rzp_test_FAKEKEY123";
export const KEY_SECRET = "test_key_secret_value";
export const WEBHOOK_SECRET = "test_webhook_secret_value";

const id = (prefix: string) => `${prefix}_${randomBytes(7).toString("hex")}`;
const nowS = () => Math.floor(Date.now() / 1000);

export class FakeGateway implements PaymentGateway {
  orders = new Map<string, GatewayOrder>();
  payments = new Map<string, GatewayPayment>();
  plans = new Map<string, { id: string; amount: number }>();
  subscriptions = new Map<string, GatewaySubscription>();
  /** Set to make every call fail like a network outage. */
  down = false;
  /** Set to make plan updates fail like a UPI subscription does. */
  rejectPlanUpdates = false;
  calls: string[] = [];

  private check(name: string) {
    this.calls.push(name);
    if (this.down) throw new GatewayError("network down", null, null);
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    this.check("createOrder");
    const o: GatewayOrder = { id: id("order"), amount: input.amountPaise, currency: "INR", status: "created", receipt: input.receipt };
    this.orders.set(o.id, o);
    return o;
  }

  async fetchPayment(paymentId: string) {
    this.check("fetchPayment");
    const p = this.payments.get(paymentId);
    if (!p) throw new GatewayError("The id provided does not exist", 400, "BAD_REQUEST_ERROR");
    return { ...p };
  }

  async capturePayment(paymentId: string, amountPaise: number) {
    this.check("capturePayment");
    const p = this.payments.get(paymentId)!;
    if (p.amount !== amountPaise) throw new GatewayError("Capture amount must be equal to the amount authorized", 400, "BAD_REQUEST_ERROR");
    p.status = "captured";
    p.captured = true;
    return { ...p };
  }

  async fetchOrderPayments(orderId: string) {
    this.check("fetchOrderPayments");
    return [...this.payments.values()].filter((p) => p.order_id === orderId);
  }

  async createPlan(input: { name: string; amountPaise: number }) {
    this.check("createPlan");
    const p = { id: id("plan"), amount: input.amountPaise };
    this.plans.set(p.id, p);
    return { id: p.id };
  }

  async createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    this.check("createSubscription");
    const s: GatewaySubscription = {
      id: id("sub"), plan_id: input.planId, status: "created", current_start: null, current_end: null, charge_at: null,
      paid_count: 0, short_url: "https://rzp.io/i/fake", notes: input.notes,
    };
    this.subscriptions.set(s.id, s);
    return { ...s };
  }

  async fetchSubscription(subscriptionId: string) {
    this.check("fetchSubscription");
    return { ...this.subscriptions.get(subscriptionId)! };
  }

  async cancelSubscription(subscriptionId: string, atCycleEnd: boolean) {
    this.check("cancelSubscription");
    const s = this.subscriptions.get(subscriptionId)!;
    if (!atCycleEnd) s.status = "cancelled";
    return { ...s };
  }

  async updateSubscriptionPlan(subscriptionId: string, planId: string) {
    this.check("updateSubscriptionPlan");
    if (this.rejectPlanUpdates) throw new GatewayError("Subscription update is not supported for this payment method", 400, "BAD_REQUEST_ERROR");
    return { ...this.subscriptions.get(subscriptionId)! };
  }

  /* ----------------------------------------------- test-side controls */

  /** Customer pays an order in Checkout. Returns the Checkout handler payload (correctly signed). */
  payOrder(orderId: string, opts: { status?: "captured" | "authorized" | "failed"; amount?: number; method?: string } = {}) {
    const o = this.orders.get(orderId)!;
    const p: GatewayPayment = {
      id: id("pay"), amount: opts.amount ?? o.amount, currency: "INR", status: opts.status ?? "captured", order_id: o.id,
      method: opts.method ?? "card", captured: (opts.status ?? "captured") === "captured", amount_refunded: 0,
      error_code: opts.status === "failed" ? "BAD_REQUEST_ERROR" : null,
      error_description: opts.status === "failed" ? "Payment declined by bank" : null, created_at: nowS(), notes: {},
    };
    this.payments.set(p.id, p);
    return {
      payment: p,
      checkout: { razorpay_order_id: o.id, razorpay_payment_id: p.id, razorpay_signature: hmacHex(KEY_SECRET, `${o.id}|${p.id}`) },
    };
  }

  /** A subscription charge (first or renewal). Advances the billing period. */
  chargeSubscription(subId: string, opts: { status?: "captured" | "failed"; amount?: number; periodDays?: number } = {}) {
    const s = this.subscriptions.get(subId)!;
    const plan = this.plans.get(s.plan_id)!;
    const ok = (opts.status ?? "captured") === "captured";
    const start = s.current_end ?? nowS();
    if (ok) {
      s.status = "active";
      s.current_start = start;
      s.current_end = start + (opts.periodDays ?? 30) * 86400;
      s.paid_count += 1;
    }
    const p: GatewayPayment = {
      id: id("pay"), amount: opts.amount ?? plan.amount, currency: "INR", status: ok ? "captured" : "failed", order_id: id("order"),
      method: "card", captured: ok, amount_refunded: 0, error_code: ok ? null : "BAD_REQUEST_ERROR",
      error_description: ok ? null : "Card declined", created_at: nowS(), notes: {}, invoice_id: id("inv"),
    };
    this.payments.set(p.id, p);
    return {
      payment: p,
      checkout: { razorpay_subscription_id: s.id, razorpay_payment_id: p.id, razorpay_signature: hmacHex(KEY_SECRET, `${p.id}|${s.id}`) },
    };
  }
}

/** Builds a Razorpay-shaped webhook body plus headers, signed with the webhook secret. */
export function webhook(
  event: string,
  entities: Record<string, unknown>,
  opts: { createdAt?: number; eventId?: string; secret?: string } = {},
) {
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_FAKE",
    event,
    contains: Object.keys(entities),
    payload: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, { entity: v }])),
    created_at: opts.createdAt ?? nowS(),
  });
  return {
    body,
    headers: { signature: hmacHex(opts.secret ?? WEBHOOK_SECRET, body), eventId: opts.eventId ?? id("evt") },
  };
}

import { createHash } from "node:crypto";

import { billingConfig, packById, planById, type PlanConfig } from "@/config/billing";
import type {
  BillingAvailability,
  BillingMode,
  BillingOverview,
  ChangePlanResponse,
  CheckoutOptions,
  CreateOrderResponse,
  CreateSubscriptionResponse,
  PaymentView,
  SubscriptionView,
  VerifyResponse,
} from "@/lib/billing-types";
import { ensureUserShop, membershipOrOnboard } from "@/server/auth/ensure-shop";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { rewardReferral, reverseReferral } from "@/server/referrals/rewards";

import type { RazorpayConfig } from "./config";
import { loadEntitlement } from "./entitlements";
import { effectivePlan, loadPlanOverrides } from "./plan-overrides";
import { GatewayError, normalizePayment, normalizeSubscription, type GatewayPayment, type GatewaySubscription, type PaymentGateway } from "./gateway";
import { fromUnix, type BillingRepository, type OrderRow, type PaymentRow, type SubscriptionRow } from "./repository";
import { verifyOrderPaymentSignature, verifySubscriptionPaymentSignature, verifyWebhookSignature } from "./signature";

/**
 * Billing use-cases.
 *
 * Rules this module enforces:
 * - Credits are granted only after Razorpay itself reports a payment as
 *   captured — from a signed webhook, or from a server-side API fetch after
 *   the checkout signature checks out. The browser saying "paid" is never enough.
 * - Every grant has a unique idempotency key, so the verify call, webhook
 *   retries and duplicate deliveries can't grant twice.
 * - Amount, currency and order/plan are checked against our own records.
 * - Only shop owners can buy, subscribe, cancel or change plans.
 */

export interface BillingDeps {
  repo: BillingRepository;
  gateway: PaymentGateway | null;
  config: RazorpayConfig | null;
  availability: BillingAvailability;
  /** Shown in Razorpay Checkout. */
  appName?: string;
  now?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export const LIVE_SUB_STATUSES = new Set(["authenticated", "active", "pending", "halted", "paused"]);
const WEBHOOK_MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

const notConfigured = (a: BillingAvailability) =>
  new DomainError("billing_not_configured", a.reason ?? "Payments aren't available right now.", 503);

function requireGateway(deps: BillingDeps) {
  if (!deps.gateway || !deps.config) throw notConfigured(deps.availability);
  return { gateway: deps.gateway, config: deps.config };
}

async function requireShop(deps: BillingDeps, userId: string, manage: boolean) {
  const m = await membershipOrOnboard(() => deps.repo.membership(userId), () => ensureUserShop(deps.repo.db, userId));
  if (manage && m.role !== "owner") throw new DomainError("forbidden", "Only the shop owner can manage billing.", 403);
  return m;
}

const nowOf = (deps: BillingDeps) => (deps.now ?? (() => new Date()))();
const log = (deps: BillingDeps, event: string, data: Record<string, unknown>) => (deps.log ?? (() => undefined))(event, data);

/**
 * A plan with no synced Razorpay price (`npm run billing:sync -- --apply`
 * creates them). Customers get a neutral message; the log says what to fix.
 */
function planNotPurchasable(deps: BillingDeps, planId: string, mode: BillingMode, reason: "price_missing" | "price_out_of_sync") {
  log(deps, "billing.plan_not_purchasable", { planId, mode, reason, fix: "npm run billing:sync -- --apply" });
  return new DomainError("billing_not_configured", "This plan can't be bought right now. Please try again later, or contact support.", 503);
}

/* ------------------------------------------------------------------ views */

function subscriptionView(s: SubscriptionRow): SubscriptionView {
  const plan = planById(s.planId);
  return {
    id: s.id,
    planId: (plan?.id ?? "trial") as SubscriptionView["planId"],
    planName: plan?.name ?? s.planId,
    status: s.status,
    currentStart: s.currentStart,
    currentEnd: s.currentEnd,
    cancelAtCycleEnd: s.cancelAtCycleEnd,
    scheduledPlanId: (s.scheduledPlanId as SubscriptionView["scheduledPlanId"]) ?? null,
    amountPaise: s.amountPaise,
    mode: s.mode,
  };
}

function paymentView(p: PaymentRow): PaymentView {
  return {
    id: p.id,
    razorpayPaymentId: p.razorpayPaymentId,
    kind: p.kind,
    description: p.description,
    amountPaise: p.amountPaise,
    amountRefundedPaise: p.amountRefundedPaise,
    status: p.status,
    method: p.method,
    errorDescription: p.errorDescription,
    creditsGranted: p.creditsGranted,
    createdAt: p.createdAt,
    receiptAvailable: p.status === "captured" || p.status === "refunded" || p.status === "partially_refunded",
  };
}

export async function getBillingOverview(deps: BillingDeps, userId: string): Promise<BillingOverview> {
  const m = await requireShop(deps, userId, false);
  const [balance, entitlement, sub, grants, payments, ledger, paidBefore, freeTrial] = await Promise.all([
    deps.repo.balance(m.shopId),
    loadEntitlement(deps.repo, m.shopId, nowOf(deps)),
    deps.repo.currentSubscription(m.shopId),
    deps.repo.activeGrants(m.shopId),
    deps.repo.payments(m.shopId),
    deps.repo.ledger(m.shopId),
    deps.repo.hasEverPaidPack(m.shopId),
    deps.repo.freeTrial(m.shopId),
  ]);
  return {
    availability: deps.availability,
    balance,
    entitlement,
    subscription: sub ? subscriptionView(sub) : null,
    grants,
    payments: payments.map(paymentView),
    ledger,
    canManage: m.role === "owner",
    firstPurchaseAvailable: !paidBefore,
    freeTrial,
  };
}

function checkoutBase(deps: BillingDeps, config: RazorpayConfig, description: string, email: string | null): CheckoutOptions {
  return { key: config.keyId, name: deps.appName ?? "Aabhar Studio", description, prefill: email ? { email } : undefined };
}

/* ------------------------------------------------------ one-time packs */

export async function createPackOrder(
  deps: BillingDeps,
  user: { id: string; email: string | null },
  input: { packId: string; idempotencyKey: string },
): Promise<CreateOrderResponse> {
  const { gateway, config } = requireGateway(deps);
  const m = await requireShop(deps, user.id, true);
  const pack = packById(input.packId);
  if (!pack) throw new DomainError("invalid_request", "That credit pack isn't available.", 400);
  if (!Number.isSafeInteger(pack.pricePaise) || pack.pricePaise < 100) {
    log(deps, "billing.invalid_pack_amount", { packId: pack.id, amountPaise: pack.pricePaise });
    throw new DomainError("billing_not_configured", "This credit pack isn't configured for a valid payment.", 503);
  }

  // Retrying the same click returns the same order instead of creating another.
  let order = await deps.repo.orderByKey(m.shopId, input.idempotencyKey);
  if (order && order.packId !== pack.id) throw new DomainError("conflict", "This request was already used for a different pack.", 409);
  if (!order) {
    if (pack.firstPurchaseOnly && (await deps.repo.hasEverPaidPack(m.shopId))) {
      throw new DomainError("conflict", `The ${pack.name} is only for your first purchase. Choose another plan.`, 409);
    }
    // Check before contacting Razorpay, so an unsynced pack can't leave an orphan Razorpay order.
    if (!(await deps.repo.packSynced({ id: pack.id, credits: pack.credits, amountPaise: pack.pricePaise }))) {
      log(deps, "billing.pack_not_purchasable", { packId: pack.id, mode: config.mode, fix: "npm run billing:sync -- --apply" });
      throw new DomainError("billing_not_configured", "This plan can't be bought right now. Please try again later, or contact support.", 503);
    }
    const receipt = `pk_${createHash("sha256").update(`${m.shopId}:${input.idempotencyKey}`).digest("hex").slice(0, 24)}`;
    const rzp = await gateway.createOrder({
      amountPaise: pack.pricePaise,
      receipt,
      notes: { shop_id: m.shopId, pack_id: pack.id, kind: "pack" },
    }).catch((err: unknown) => {
      log(deps, "billing.order_create_failed", { error: String(err) });
      throw new DomainError("payment_failed", "We couldn't start the payment. Please try again.", 502);
    });
    if (rzp.amount !== pack.pricePaise || rzp.currency !== "INR") throw new DomainError("internal_error", "Payment gateway returned an unexpected order.", 502);
    try {
      order = await deps.repo.insertOrder({
        shopId: m.shopId, packId: pack.id, credits: pack.credits, validityDays: pack.validityDays, amountPaise: pack.pricePaise,
        mode: config.mode, razorpayOrderId: rzp.id, idempotencyKey: input.idempotencyKey, userId: user.id,
      });
    } catch (err) {
      // A concurrent identical request inserted first; use its order.
      order = await deps.repo.orderByKey(m.shopId, input.idempotencyKey);
      if (!order) throw err;
    }
  }
  if (order.status === "paid") throw new DomainError("conflict", "This order has already been paid.", 409);

  return {
    orderId: order.razorpayOrderId,
    checkout: {
      ...checkoutBase(deps, config, `${pack.name} — image credits`, user.email),
      order_id: order.razorpayOrderId,
      amount: order.amountPaise,
      currency: "INR",
      notes: { pack_id: pack.id },
    },
  };
}

type PackOutcome = "granted" | "already_granted" | "not_captured" | "mismatch";

/** Grants a pack's credits for a captured payment that matches our order exactly. */
async function applyPackPayment(deps: BillingDeps, order: OrderRow, payment: GatewayPayment): Promise<{ outcome: PackOutcome; credits: number }> {
  if (payment.order_id !== order.razorpayOrderId || payment.amount !== order.amountPaise || payment.currency !== "INR") {
    log(deps, "billing.pack_payment_mismatch", { order: order.razorpayOrderId, payment: payment.id, amount: payment.amount, expected: order.amountPaise });
    return { outcome: "mismatch", credits: 0 };
  }
  const pack = packById(order.packId);
  const description = `${pack?.name ?? `${order.credits} credits`} — image credits`;
  const status = payment.status === "captured" ? "captured" : payment.status === "failed" ? "failed" : payment.status === "authorized" ? "authorized" : "created";

  return deps.repo.withTx(async (repo) => {
    const row = await repo.upsertPayment({
      shopId: order.shopId, razorpayPaymentId: payment.id, kind: "pack", orderId: order.id, subscriptionId: null,
      amountPaise: payment.amount, currency: payment.currency, status, method: payment.method,
      errorCode: payment.error_code, errorDescription: payment.error_description, description,
    });
    if (status !== "captured") return { outcome: "not_captured" as const, credits: 0 };

    // One grant per order, even if Razorpay ever reports a second captured payment for it.
    const key = `grant:order:${order.razorpayOrderId}`;
    const expires = new Date(nowOf(deps).getTime() + order.validityDays * DAY_MS);
    const grantId = await repo.grantCredits({
      shopId: order.shopId, amount: order.credits, source: "pack", expiresAt: expires, key,
      reason: `Bought ${order.credits} credits`, paymentId: row.id,
    });
    await repo.markOrderPaid(order.id);
    if (!grantId) return { outcome: "already_granted" as const, credits: 0 };
    await repo.setPaymentGrant(row.id, order.credits, grantId);
    if ((await rewardReferral(repo, { shopId: order.shopId, packId: order.packId, paymentId: row.id, now: nowOf(deps) })) === "rewarded") {
      log(deps, "billing.referral_rewarded", { paymentId: row.id });
    }
    return { outcome: "granted" as const, credits: order.credits };
  });
}

export async function verifyPackPayment(
  deps: BillingDeps,
  userId: string,
  input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
): Promise<VerifyResponse> {
  const { gateway, config } = requireGateway(deps);
  const m = await requireShop(deps, userId, true);
  const order = await deps.repo.orderByRazorpayId(input.razorpay_order_id);
  if (!order || order.shopId !== m.shopId) throw domainErrors.notFound("Order");
  if (!verifyOrderPaymentSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, config.keySecret)) {
    log(deps, "billing.bad_checkout_signature", { order: order.razorpayOrderId });
    throw new DomainError("payment_failed", "We couldn't verify this payment. If money was taken, it will be confirmed or refunded automatically.", 400);
  }

  let credits = 0;
  let confirmed = false;
  try {
    let payment = await gateway.fetchPayment(input.razorpay_payment_id);
    if (payment.status === "authorized" && payment.order_id === order.razorpayOrderId && payment.amount === order.amountPaise && payment.currency === "INR") {
      payment = await gateway.capturePayment(payment.id, order.amountPaise);
    }
    const r = await applyPackPayment(deps, order, payment);
    if (r.outcome === "mismatch") throw new DomainError("payment_failed", "This payment doesn't match the order. Contact support; no credits were added.", 400);
    confirmed = r.outcome === "granted" || r.outcome === "already_granted";
    credits = r.credits;
  } catch (err) {
    if (err instanceof DomainError) throw err;
    // Razorpay unreachable: the webhook (or the reconcile cron) will finish this.
    log(deps, "billing.verify_deferred", { order: order.razorpayOrderId, error: String(err) });
  }
  return { status: confirmed ? "confirmed" : "pending", creditsGranted: credits, balance: await deps.repo.balance(m.shopId) };
}

/* ---------------------------------------------------------- subscriptions */

async function resolvePlanFromGateway(deps: BillingDeps, razorpayPlanId: string) {
  const price = await deps.repo.priceByRazorpayPlanId(razorpayPlanId);
  const plan = price ? planById(price.planId) : undefined;
  return price && plan ? { price, plan } : null;
}

export async function createSubscription(
  deps: BillingDeps,
  user: { id: string; email: string | null },
  input: { planId: string },
): Promise<CreateSubscriptionResponse> {
  const { gateway, config } = requireGateway(deps);
  const m = await requireShop(deps, user.id, true);
  const plan = planById(input.planId);
  if (!plan || plan.monthlyPricePaise === null) throw new DomainError("invalid_request", "Choose a paid plan.", 400);

  const current = await deps.repo.currentSubscription(m.shopId);
  if (current && LIVE_SUB_STATUSES.has(current.status) && current.status !== "halted") {
    throw new DomainError("conflict", "You already have a subscription. Use “Change plan” instead.", 409);
  }
  const price = await deps.repo.activePrice(plan.id, config.mode);
  if (!price) throw planNotPurchasable(deps, plan.id, config.mode, "price_missing");
  if (price.amountPaise !== plan.monthlyPricePaise) throw planNotPurchasable(deps, plan.id, config.mode, "price_out_of_sync");

  // Reuse a recent unpaid checkout for the same price; retire older ones.
  for (const pending of await deps.repo.pendingCheckouts(m.shopId)) {
    const fresh = nowOf(deps).getTime() - new Date(pending.createdAt).getTime() < 60 * 60_000;
    if (fresh && pending.priceId === price.id) {
      return {
        subscriptionId: pending.razorpaySubscriptionId,
        checkout: { ...checkoutBase(deps, config, `${plan.name} plan — monthly`, user.email), subscription_id: pending.razorpaySubscriptionId },
      };
    }
    await gateway.cancelSubscription(pending.razorpaySubscriptionId, false).catch(() => undefined);
    await deps.repo.markCheckoutAbandoned(pending.id);
  }

  // A halted subscription can't take a new card from here: end it, then start fresh.
  if (current?.status === "halted") {
    const cancelled = await gateway.cancelSubscription(current.razorpaySubscriptionId, false);
    await deps.repo.applySubscriptionState(current.id, { status: cancelled.status, currentStart: null, currentEnd: null, eventAt: null });
  }

  const sub = await gateway
    .createSubscription({ planId: price.razorpayPlanId, totalCount: billingConfig.subscriptionTotalCount, notes: { shop_id: m.shopId, plan_id: plan.id } })
    .catch((err: unknown) => {
      log(deps, "billing.subscription_create_failed", { error: String(err) });
      throw new DomainError("payment_failed", "We couldn't start the subscription. Please try again.", 502);
    });
  await deps.repo.insertSubscription({
    shopId: m.shopId, planId: plan.id, priceId: price.id, mode: config.mode, razorpaySubscriptionId: sub.id,
    status: sub.status || "created", shortUrl: sub.short_url, userId: user.id,
  });
  return {
    subscriptionId: sub.id,
    checkout: { ...checkoutBase(deps, config, `${plan.name} plan — monthly`, user.email), subscription_id: sub.id },
  };
}

type ChargeOutcome = "granted" | "already_granted" | "not_captured" | "mismatch" | "unknown_plan";

/**
 * Records a subscription charge and grants that month's credits. Credits
 * expire when the billing period they paid for ends.
 */
async function applySubscriptionCharge(
  deps: BillingDeps,
  sub: SubscriptionRow,
  gSub: GatewaySubscription,
  payment: GatewayPayment,
  eventAt: Date | null,
): Promise<{ outcome: ChargeOutcome; credits: number }> {
  const resolved = await resolvePlanFromGateway(deps, gSub.plan_id);
  if (!resolved) {
    log(deps, "billing.unknown_razorpay_plan", { subscription: gSub.id, plan: gSub.plan_id });
    return { outcome: "unknown_plan", credits: 0 };
  }
  const { price, plan } = resolved;
  if (payment.amount !== price.amountPaise || payment.currency !== "INR") {
    log(deps, "billing.subscription_amount_mismatch", { subscription: gSub.id, payment: payment.id, amount: payment.amount, expected: price.amountPaise });
    return { outcome: "mismatch", credits: 0 };
  }
  const status = payment.status === "captured" ? "captured" : payment.status === "failed" ? "failed" : payment.status === "authorized" ? "authorized" : "created";
  const periodStart = fromUnix(gSub.current_start) ?? nowOf(deps);
  const periodEnd = fromUnix(gSub.current_end) ?? new Date(periodStart.getTime() + 31 * DAY_MS);

  return deps.repo.withTx(async (repo) => {
    await repo.lockSubscription(sub.id);
    const row = await repo.upsertPayment({
      shopId: sub.shopId, razorpayPaymentId: payment.id, kind: "subscription", orderId: null, subscriptionId: sub.id,
      amountPaise: payment.amount, currency: payment.currency, status, method: payment.method,
      errorCode: payment.error_code, errorDescription: payment.error_description,
      description: `${plan.name} plan — ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
    });
    await repo.applySubscriptionState(sub.id, {
      status: gSub.status, currentStart: fromUnix(gSub.current_start), currentEnd: fromUnix(gSub.current_end), eventAt, planId: plan.id, priceId: price.id,
    });
    if (status !== "captured") return { outcome: "not_captured" as const, credits: 0 };
    // Monthly credits as currently configured (an admin override wins over the config file).
    const monthlyCredits = effectivePlan(plan.id, await loadPlanOverrides(repo.db))?.monthlyCredits ?? plan.monthlyCredits;
    if (monthlyCredits <= 0) return { outcome: "granted" as const, credits: 0 };

    const grantId = await repo.grantCredits({
      shopId: sub.shopId, amount: monthlyCredits, source: "plan", expiresAt: periodEnd, key: `grant:subpay:${payment.id}`,
      reason: `${plan.name} plan credits`, subscriptionId: sub.id, paymentId: row.id, periodStart, periodEnd,
    });
    if (!grantId) return { outcome: "already_granted" as const, credits: 0 };
    await repo.setPaymentGrant(row.id, monthlyCredits, grantId);
    return { outcome: "granted" as const, credits: monthlyCredits };
  });
}

export async function verifySubscriptionPayment(
  deps: BillingDeps,
  userId: string,
  input: { razorpay_subscription_id: string; razorpay_payment_id: string; razorpay_signature: string },
): Promise<VerifyResponse> {
  const { gateway, config } = requireGateway(deps);
  const m = await requireShop(deps, userId, true);
  const sub = await deps.repo.subscriptionByRazorpayId(input.razorpay_subscription_id);
  if (!sub || sub.shopId !== m.shopId) throw domainErrors.notFound("Subscription");
  if (!verifySubscriptionPaymentSignature(input.razorpay_payment_id, input.razorpay_subscription_id, input.razorpay_signature, config.keySecret)) {
    log(deps, "billing.bad_checkout_signature", { subscription: sub.razorpaySubscriptionId });
    throw new DomainError("payment_failed", "We couldn't verify this payment. If money was taken, it will be confirmed or refunded automatically.", 400);
  }

  let credits = 0;
  let confirmed = false;
  try {
    const [gSub, payment] = await Promise.all([gateway.fetchSubscription(sub.razorpaySubscriptionId), gateway.fetchPayment(input.razorpay_payment_id)]);
    const r = await applySubscriptionCharge(deps, sub, gSub, payment, null);
    if (r.outcome === "mismatch") throw new DomainError("payment_failed", "This payment doesn't match the plan price. Contact support; no credits were added.", 400);
    confirmed = r.outcome === "granted" || r.outcome === "already_granted";
    credits = r.credits;
  } catch (err) {
    if (err instanceof DomainError) throw err;
    log(deps, "billing.verify_deferred", { subscription: sub.razorpaySubscriptionId, error: String(err) });
  }
  return { status: confirmed ? "confirmed" : "pending", creditsGranted: credits, balance: await deps.repo.balance(m.shopId) };
}

export async function cancelSubscription(deps: BillingDeps, userId: string, atCycleEnd = true): Promise<SubscriptionView> {
  const { gateway } = requireGateway(deps);
  const m = await requireShop(deps, userId, true);
  const sub = await deps.repo.currentSubscription(m.shopId);
  if (!sub || !LIVE_SUB_STATUSES.has(sub.status)) throw new DomainError("invalid_request", "There's no active subscription to cancel.", 400);
  const g = await gateway.cancelSubscription(sub.razorpaySubscriptionId, atCycleEnd).catch((err: unknown) => {
    log(deps, "billing.cancel_failed", { error: String(err) });
    throw new DomainError("payment_failed", "We couldn't cancel right now. Please try again.", 502);
  });
  await deps.repo.applySubscriptionState(sub.id, {
    status: g.status, currentStart: fromUnix(g.current_start), currentEnd: fromUnix(g.current_end), eventAt: null, cancelAtCycleEnd: atCycleEnd,
  });
  return subscriptionView((await deps.repo.subscriptionByRazorpayId(sub.razorpaySubscriptionId))!);
}

export async function changePlan(deps: BillingDeps, userId: string, input: { planId: string }): Promise<ChangePlanResponse> {
  const { gateway, config } = requireGateway(deps);
  const m = await requireShop(deps, userId, true);
  const plan: PlanConfig | undefined = planById(input.planId);
  if (!plan || plan.monthlyPricePaise === null) throw new DomainError("invalid_request", "Choose a paid plan.", 400);
  const sub = await deps.repo.currentSubscription(m.shopId);
  if (!sub || (sub.status !== "active" && sub.status !== "authenticated")) {
    throw new DomainError("invalid_request", "Plan changes need an active subscription.", 400);
  }
  if (sub.planId === plan.id && !sub.scheduledPlanId) throw new DomainError("invalid_request", `You're already on ${plan.name}.`, 400);
  const price = await deps.repo.activePrice(plan.id, config.mode);
  if (!price) throw planNotPurchasable(deps, plan.id, config.mode, "price_missing");

  try {
    await gateway.updateSubscriptionPlan(sub.razorpaySubscriptionId, price.razorpayPlanId);
  } catch (err) {
    if (err instanceof GatewayError && !err.transient) {
      // Razorpay doesn't allow plan updates for UPI and eMandate subscriptions.
      return {
        status: "requires_resubscribe",
        message: `Your payment method can't switch plans automatically. Cancel at the end of this period, then subscribe to ${plan.name}.`,
        subscription: subscriptionView(sub),
      };
    }
    throw new DomainError("payment_failed", "We couldn't change your plan right now. Please try again.", 502);
  }
  await deps.repo.setScheduledPlan(sub.id, plan.id === sub.planId ? null : plan.id);
  return {
    status: "scheduled",
    message: plan.id === sub.planId ? "Scheduled change removed." : `You'll move to ${plan.name} at your next renewal.`,
    subscription: subscriptionView((await deps.repo.subscriptionByRazorpayId(sub.razorpaySubscriptionId))!),
  };
}

/* ---------------------------------------------------------------- webhooks */

interface WebhookEnvelope {
  event: string;
  created_at?: number;
  payload?: Record<string, { entity?: Record<string, unknown> } | undefined>;
}

export interface WebhookResult {
  status: number;
  outcome: string;
}

/**
 * Entry point for POST /api/webhooks/razorpay.
 *
 * 1. Verify the HMAC over the raw body (constant-time). Reject if it fails.
 * 2. Store the event by X-Razorpay-Event-Id. Duplicates that were already
 *    processed return 200 without doing anything.
 * 3. Process inside a transaction holding a row lock on the event, then mark
 *    it processed. Failures leave it unprocessed and return 500 so Razorpay retries.
 */
export async function handleRazorpayWebhook(
  deps: BillingDeps,
  rawBody: string,
  headers: { signature: string | null; eventId: string | null },
): Promise<WebhookResult> {
  const secret = deps.config?.webhookSecret;
  if (!deps.config || !secret) return { status: 503, outcome: "not_configured" };
  if (!verifyWebhookSignature(rawBody, headers.signature, secret)) {
    log(deps, "billing.webhook_bad_signature", {});
    return { status: 400, outcome: "bad_signature" };
  }

  let env: WebhookEnvelope;
  try {
    env = JSON.parse(rawBody) as WebhookEnvelope;
  } catch {
    return { status: 400, outcome: "bad_json" };
  }
  if (typeof env.event !== "string") return { status: 400, outcome: "bad_event" };

  const eventId = headers.eventId || `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
  const createdAt = fromUnix(typeof env.created_at === "number" ? env.created_at : null);
  const recorded = await deps.repo.recordWebhookEvent({ eventId, type: env.event, mode: deps.config.mode, payload: rawBody, createdAt });
  if (recorded.alreadyProcessed) return { status: 200, outcome: "duplicate" };

  if (createdAt && nowOf(deps).getTime() - createdAt.getTime() > WEBHOOK_MAX_AGE_DAYS * DAY_MS) {
    await deps.repo.markWebhookProcessed(eventId, "stale_ignored");
    return { status: 200, outcome: "stale_ignored" };
  }

  try {
    const outcome = await deps.repo.withTx(async (repo) => {
      const lock = await repo.lockWebhookEvent(eventId);
      if (lock.processed) return "duplicate";
      const txDeps = { ...deps, repo };
      const result = await processEvent(txDeps, env, createdAt);
      await repo.markWebhookProcessed(eventId, result);
      return result;
    });
    log(deps, "billing.webhook_processed", { event: env.event, eventId, outcome });
    return { status: 200, outcome };
  } catch (err) {
    await deps.repo.markWebhookFailed(eventId, String(err)).catch(() => undefined);
    log(deps, "billing.webhook_failed", { event: env.event, eventId, error: String(err) });
    return { status: 500, outcome: "error" };
  }
}

const entityOf = (env: WebhookEnvelope, key: string) => env.payload?.[key]?.entity ?? null;

async function processEvent(deps: BillingDeps, env: WebhookEnvelope, eventAt: Date | null): Promise<string> {
  const paymentEntity = entityOf(env, "payment");
  const subEntity = entityOf(env, "subscription");
  const refundEntity = entityOf(env, "refund");

  switch (env.event) {
    case "payment.authorized":
    case "payment.captured":
    case "payment.failed":
    case "order.paid": {
      if (!paymentEntity) return "no_payment";
      let payment = normalizePayment(paymentEntity);
      const order = payment.order_id ? await deps.repo.orderByRazorpayId(payment.order_id) : null;
      if (!order) return "ignored_not_pack"; // subscription payments are handled by subscription.* events
      if (payment.status === "authorized" && deps.gateway && payment.amount === order.amountPaise) {
        // Orders are created with automatic capture; capture explicitly if the account doesn't auto-capture.
        payment = await deps.gateway.capturePayment(payment.id, order.amountPaise).catch(() => payment);
      }
      return `pack_${(await applyPackPayment(deps, order, payment)).outcome}`;
    }

    case "subscription.charged": {
      if (!subEntity || !paymentEntity) return "incomplete_payload";
      const gSub = normalizeSubscription(subEntity);
      const sub = await deps.repo.subscriptionByRazorpayId(gSub.id);
      if (!sub) return "unknown_subscription";
      return `charge_${(await applySubscriptionCharge(deps, sub, gSub, normalizePayment(paymentEntity), eventAt)).outcome}`;
    }

    case "subscription.authenticated":
    case "subscription.activated":
    case "subscription.pending":
    case "subscription.halted":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.updated": {
      if (!subEntity) return "no_subscription";
      const gSub = normalizeSubscription(subEntity);
      const sub = await deps.repo.subscriptionByRazorpayId(gSub.id);
      if (!sub) return "unknown_subscription";
      const resolved = await resolvePlanFromGateway(deps, gSub.plan_id);
      await deps.repo.lockSubscription(sub.id);
      const applied = await deps.repo.applySubscriptionState(sub.id, {
        status: gSub.status, currentStart: fromUnix(gSub.current_start), currentEnd: fromUnix(gSub.current_end), eventAt,
        planId: resolved?.plan.id, priceId: resolved?.price.id,
      });
      // A failed renewal attempt arrives with pending/halted: keep it in billing history.
      if (paymentEntity && (env.event === "subscription.pending" || env.event === "subscription.halted")) {
        const p = normalizePayment(paymentEntity);
        if (p.status === "failed") {
          await deps.repo.upsertPayment({
            shopId: sub.shopId, razorpayPaymentId: p.id, kind: "subscription", orderId: null, subscriptionId: sub.id,
            amountPaise: p.amount || sub.amountPaise, currency: p.currency || "INR", status: "failed", method: p.method,
            errorCode: p.error_code, errorDescription: p.error_description ?? "Renewal payment failed", description: `${planById(sub.planId)?.name ?? sub.planId} plan — renewal attempt`,
          });
        }
      }
      return applied ? `subscription_${gSub.status}` : "out_of_order_skipped";
    }

    case "refund.created":
    case "refund.processed":
    case "refund.failed": {
      if (!refundEntity) return "no_refund";
      return handleRefund(deps, env.event, refundEntity, paymentEntity);
    }

    default:
      return "ignored_event";
  }
}

/**
 * Refunds are issued from the Razorpay Dashboard. When one is processed we
 * take back the matching share of that payment's credits from the grant it
 * created. Credits already spent can't be taken back; that shortfall is
 * recorded on the refund for review.
 */
async function handleRefund(
  deps: BillingDeps,
  event: string,
  refund: Record<string, unknown>,
  paymentEntity: Record<string, unknown> | null,
): Promise<string> {
  const refundId = String(refund.id);
  const paymentId = String(refund.payment_id ?? "");
  const amount = Number(refund.amount ?? 0);
  const payment = await deps.repo.paymentByRazorpayId(paymentId);
  if (!payment) return "refund_unknown_payment";

  const status = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : "created";
  const existing = await deps.repo.refundByRazorpayId(refundId);
  if (existing?.status === "processed") return "refund_already_processed";
  await deps.repo.upsertRefund({ shopId: payment.shopId, paymentId: payment.id, razorpayRefundId: refundId, amountPaise: amount, status });
  if (status !== "processed") return `refund_${status}`;

  const reportedTotal = paymentEntity ? Number(paymentEntity.amount_refunded ?? 0) : 0;
  const totalRefunded = Math.min(payment.amountPaise, Math.max(reportedTotal, payment.amountRefundedPaise + amount));
  const target = totalRefunded >= payment.amountPaise ? payment.creditsGranted : Math.floor((payment.creditsGranted * totalRefunded) / payment.amountPaise);
  const toReverse = Math.max(0, target - (await deps.repo.creditsAlreadyReversed(payment.id)));

  let reversed = 0;
  let shortfall = 0;
  if (toReverse > 0 && payment.grantId) {
    ({ reversed, shortfall } = await deps.repo.reverseGrant(payment.grantId, toReverse, `refund:rzp:${refundId}`, "Payment refunded"));
  }
  await deps.repo.markRefundProcessed(refundId, reversed, shortfall);
  await deps.repo.setPaymentRefunded(payment.id, totalRefunded);
  if (totalRefunded >= payment.amountPaise && (await reverseReferral(deps.repo, payment.id, `refund:rzp:${refundId}`))) {
    log(deps, "billing.referral_reversed", { paymentId: payment.id });
  }
  if (shortfall > 0) log(deps, "billing.refund_shortfall", { refund: refundId, shortfall });
  return "refund_processed";
}

/* --------------------------------------------------------------- cron */

/**
 * Expires lapsed credits, and confirms pack orders whose webhook never
 * arrived by asking Razorpay directly.
 */
export async function reconcileBilling(deps: BillingDeps): Promise<{ expired: number; ordersConfirmed: number }> {
  const expired = await deps.repo.expireAllGrants();
  let ordersConfirmed = 0;
  if (deps.gateway) {
    for (const order of await deps.repo.unpaidOrders(10, 72)) {
      try {
        const payments = await deps.gateway.fetchOrderPayments(order.razorpayOrderId);
        const captured = payments.find((p) => p.status === "captured");
        if (captured && (await applyPackPayment(deps, order, captured)).outcome === "granted") ordersConfirmed++;
      } catch (err) {
        log(deps, "billing.reconcile_order_failed", { order: order.razorpayOrderId, error: String(err) });
      }
    }
  }
  return { expired, ordersConfirmed };
}

/* ---------------------------------------------------------- receipts */

function financialYear(d: Date) {
  // Indian financial year: April to March. Uses IST.
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export interface ReceiptData {
  receiptNumber: string;
  issuedAt: string;
  mode: "test" | "live";
  payment: PaymentView & { razorpayPaymentId: string; capturedAt: string | null };
  buyer: Record<string, string>;
  seller: typeof billingConfig.receipts.seller;
  pricesIncludeGst: boolean;
  gstRatePercent: number;
}

export async function getReceiptData(deps: BillingDeps, userId: string, paymentId: string): Promise<ReceiptData> {
  const m = await requireShop(deps, userId, false);
  const payment = await deps.repo.paymentForShop(m.shopId, paymentId);
  if (!payment) throw domainErrors.notFound("Payment");
  const view = paymentView(payment);
  if (!view.receiptAvailable) throw new DomainError("invalid_request", "Receipts are available for successful payments only.", 400);

  const profile = await deps.repo.businessProfile(m.shopId);
  const buyer: Record<string, string> = {
    name: profile?.businessName || profile?.name || "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
  };
  const paidAt = new Date(payment.capturedAt ?? payment.createdAt);
  const receipt = await deps.repo.issueReceipt(m.shopId, payment.id, `${billingConfig.receipts.prefix}/${financialYear(paidAt)}`, buyer);
  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    mode: await paymentMode(deps, payment, deps.config?.mode ?? "test"),
    payment: { ...view, razorpayPaymentId: payment.razorpayPaymentId, capturedAt: payment.capturedAt },
    buyer: receipt.buyer,
    seller: billingConfig.receipts.seller,
    pricesIncludeGst: billingConfig.gst.pricesIncludeGst,
    gstRatePercent: billingConfig.gst.ratePercent,
  };
}

async function paymentMode(deps: BillingDeps, payment: PaymentRow, fallback: "test" | "live"): Promise<"test" | "live"> {
  if (payment.orderId) {
    const rows = await deps.repo.db.query<{ mode: "test" | "live" }>(`select mode from public.billing_orders where id = $1`, [payment.orderId]);
    if (rows[0]) return rows[0].mode;
  }
  if (payment.subscriptionId) {
    const rows = await deps.repo.db.query<{ mode: "test" | "live" }>(`select mode from public.billing_subscriptions where id = $1`, [payment.subscriptionId]);
    if (rows[0]) return rows[0].mode;
  }
  return fallback;
}

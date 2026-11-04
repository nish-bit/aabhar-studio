/**
 * JSON contracts for the billing API. Amounts are always integer paise.
 */
import type { PlanId, PlanLimits } from "@/config/billing";

export type BillingMode = "test" | "live";

export type SubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "paused"
  | "cancelled"
  | "completed"
  | "expired";

/** What the billing page needs to know about configuration. Never contains secrets. */
export interface BillingAvailability {
  /** Keys present and allowed for the current mode. */
  enabled: boolean;
  mode: BillingMode | null;
  /** Human reason when not enabled (e.g. live keys awaiting approval). */
  reason: string | null;
  /** Public key id for Checkout (safe to expose). */
  keyId: string | null;
}

export interface EntitlementView {
  planId: PlanId;
  planName: string;
  /**
   * "trial" | "pack" (has bought a credit pack) | "subscribed" | "grace"
   * (cancelled, paid period still running) | "past_due" | "lapsed".
   */
  state: "trial" | "pack" | "subscribed" | "grace" | "past_due" | "lapsed";
  limits: PlanLimits;
}

export interface CreditGrantView {
  id: string;
  source: "trial" | "plan" | "pack" | "admin" | "refund_restore" | "legacy" | "referral" | "refund_request";
  amount: number;
  remaining: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface SubscriptionView {
  id: string;
  planId: PlanId;
  planName: string;
  status: SubscriptionStatus;
  currentStart: string | null;
  currentEnd: string | null;
  cancelAtCycleEnd: boolean;
  scheduledPlanId: PlanId | null;
  amountPaise: number;
  mode: BillingMode;
}

export interface PaymentView {
  id: string;
  razorpayPaymentId: string;
  kind: "pack" | "subscription";
  description: string;
  amountPaise: number;
  amountRefundedPaise: number;
  status: "created" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";
  method: string | null;
  errorDescription: string | null;
  creditsGranted: number;
  createdAt: string;
  receiptAvailable: boolean;
}

export interface LedgerEntryView {
  id: string;
  type: "grant" | "debit" | "refund" | "adjustment" | "expiry";
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
}

/** The account's one-time free trial grant (null if it never had one). */
export interface FreeTrialView {
  /** Free generations granted at sign-up. */
  total: number;
  /** Still usable: unspent and not expired. */
  remaining: number;
  expiresAt: string | null;
  expired: boolean;
}

export interface BillingOverview {
  availability: BillingAvailability;
  balance: number;
  entitlement: EntitlementView;
  subscription: SubscriptionView | null;
  grants: CreditGrantView[];
  payments: PaymentView[];
  ledger: LedgerEntryView[];
  canManage: boolean;
  /** Packs marked firstPurchaseOnly (the Starter Pack) can still be bought: no pack has ever been paid for. */
  firstPurchaseAvailable: boolean;
  freeTrial: FreeTrialView | null;
}

/* ------------------------------------------------------------- checkout */

export interface CreateOrderRequest {
  packId: string;
  idempotencyKey: string;
}

/** Options the browser passes to Razorpay Checkout. */
export interface CheckoutOptions {
  key: string;
  name: string;
  description: string;
  order_id?: string;
  subscription_id?: string;
  amount?: number;
  currency?: "INR";
  prefill?: { email?: string };
  notes?: Record<string, string>;
}

export interface CreateOrderResponse {
  orderId: string;
  checkout: CheckoutOptions;
}

export interface VerifyOrderRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface CreateSubscriptionRequest {
  planId: string;
}

export interface CreateSubscriptionResponse {
  subscriptionId: string;
  checkout: CheckoutOptions;
}

export interface VerifySubscriptionRequest {
  razorpay_subscription_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/**
 * Result of a verify call. "confirmed": Razorpay confirmed the payment and
 * credits were granted. "pending": the signature matched but Razorpay hasn't
 * confirmed capture yet; the webhook will finish it.
 */
export interface VerifyResponse {
  status: "confirmed" | "pending";
  creditsGranted: number;
  balance: number;
}

export interface ChangePlanRequest {
  planId: string;
}

export interface ChangePlanResponse {
  status: "scheduled" | "requires_resubscribe";
  message: string;
  subscription: SubscriptionView | null;
}

export interface CancelSubscriptionRequest {
  /** true (default): keep access until the paid period ends. */
  atCycleEnd?: boolean;
}

import { writeLog, type LogLevel } from "@/server/logging";

/**
 * Log levels for billing events. Error-level lines are the ones to alert on
 * (Workers Logs: level = "error" and event starts with "billing."): each means
 * money may have moved without the matching credits, or someone is sending
 * forged requests. Payloads are scrubbed by writeLog and carry only Razorpay
 * ids, amounts and outcomes, never customer contact details or secrets.
 */
export const BILLING_ERROR_EVENTS: ReadonlySet<string> = new Set([
  /** A captured or authorized payment whose order, amount or currency doesn't match ours: no credits given. */
  "billing.pack_payment_mismatch",
  "billing.subscription_amount_mismatch",
  /** A second first-purchase-only pack was paid for: no credits given; refund it. */
  "billing.first_purchase_conflict",
  /** A refund took back fewer credits than it should (already spent). */
  "billing.refund_shortfall",
  /** Webhook processing failed (Razorpay retries) or arrived with a bad signature. */
  "billing.webhook_failed",
  "billing.webhook_bad_signature",
  "billing.webhook_unhandled",
  /** A checkout callback with a forged or corrupted signature. */
  "billing.bad_checkout_signature",
  /** Reconciliation couldn't check an order, or a whole run failed. */
  "billing.reconcile_order_failed",
  "billing.reconcile_failed",
  /** Configuration that makes payments wrong rather than unavailable. */
  "billing.invalid_pack_amount",
  "billing.unknown_razorpay_plan",
]);

/** Transient or configuration problems worth seeing, but not paging anyone for. */
export const BILLING_WARN_EVENTS: ReadonlySet<string> = new Set([
  "billing.verify_deferred",
  "billing.order_create_failed",
  "billing.subscription_create_failed",
  "billing.cancel_failed",
  "billing.plan_not_purchasable",
  "billing.pack_not_purchasable",
  "billing.reconcile_run_not_recorded",
  /** A webhook request refused before its signature could be checked (too large, bad Content-Length, not UTF-8). */
  "billing.webhook_rejected",
]);

export function billingLogLevel(event: string): LogLevel {
  if (BILLING_ERROR_EVENTS.has(event)) return "error";
  if (BILLING_WARN_EVENTS.has(event)) return "warn";
  return "info";
}

/** The production billing logger (BillingDeps.log). */
export function billingLog(event: string, data: Record<string, unknown>): void {
  writeLog(billingLogLevel(event), event, data);
}

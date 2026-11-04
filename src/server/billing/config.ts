import "server-only";

import type { BillingAvailability, BillingMode } from "@/lib/billing-types";
import { serverEnv } from "@/server/env";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  mode: BillingMode;
}

/**
 * Razorpay configuration with the live-billing guard.
 *
 * The mode comes from the key itself (rzp_test_ / rzp_live_), so it can't be
 * mislabelled. Live keys are refused unless BILLING_LIVE_APPROVED=true.
 */
export function billingConfigState(): { config: RazorpayConfig | null; availability: BillingAvailability } {
  const env = serverEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    return {
      config: null,
      availability: { enabled: false, mode: null, keyId: null, reason: "Payments aren't connected yet. An administrator needs to add the Razorpay keys." },
    };
  }
  const mode: BillingMode = env.RAZORPAY_KEY_ID.startsWith("rzp_live_") ? "live" : "test";
  if (mode === "live" && env.BILLING_LIVE_APPROVED !== "true") {
    return {
      config: null,
      availability: { enabled: false, mode, keyId: null, reason: "Live payments are switched off until the billing configuration is approved." },
    };
  }
  return {
    config: { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null, mode },
    availability: { enabled: true, mode, keyId: env.RAZORPAY_KEY_ID, reason: null },
  };
}

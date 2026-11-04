"use client";

import type { CheckoutOptions } from "@/lib/billing-types";

/**
 * Loads Razorpay Checkout (https://checkout.razorpay.com/v1/checkout.js) on
 * demand and opens it. The result is only a *claim* that the customer paid:
 * the server verifies the signature and confirms with Razorpay before any
 * credits are granted.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}

export type CheckoutResult =
  | { kind: "success"; response: CheckoutSuccess }
  | { kind: "dismissed"; lastError: string | null };

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

function loadScript(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      loading = null;
      script.remove();
      reject(error);
    };
    const timeout = window.setTimeout(() => fail(new Error("Razorpay Checkout took too long to load. Check your connection and try again.")), 15_000);
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (settled) return;
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (!ctor) {
        window.clearTimeout(timeout);
        fail(new Error("Razorpay Checkout didn't load."));
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve(ctor);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      fail(new Error("Couldn't load Razorpay Checkout. Check your connection or disable blockers for checkout.razorpay.com."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openCheckout(options: CheckoutOptions): Promise<CheckoutResult> {
  const Razorpay = await loadScript();
  return new Promise<CheckoutResult>((resolve) => {
    let lastError: string | null = null;
    let settled = false;
    const rzp = new Razorpay({
      ...options,
      theme: { color: "#8a6a2f" },
      handler: (response: CheckoutSuccess) => {
        settled = true;
        resolve({ kind: "success", response });
      },
      modal: {
        ondismiss: () => {
          if (!settled) resolve({ kind: "dismissed", lastError });
        },
        confirm_close: true,
      },
    });
    // The customer can retry inside Checkout after a failure, so just remember it.
    rzp.on("payment.failed", (resp) => {
      lastError = resp.error?.description ?? "The payment didn't go through.";
    });
    rzp.open();
  });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BillingOverview } from "@/lib/billing-types";

import { ApiError, billingApi } from "./api-client";
import { openCheckout } from "./razorpay-checkout";

/**
 * Checkout states shown to the user:
 * - starting:  creating the order / subscription on our server
 * - open:      Razorpay Checkout is showing
 * - verifying: Checkout reported success; the server is confirming with Razorpay
 * - success:   Razorpay confirmed capture and credits were added
 * - pending:   signature fine, but Razorpay hasn't confirmed yet — we keep checking
 * - failed:    payment failed or couldn't be verified
 * - cancelled: the customer closed Checkout without paying
 */
export type CheckoutPhase =
  | { phase: "idle" }
  | { phase: "starting"; label: string }
  | { phase: "open"; label: string }
  | { phase: "verifying"; label: string }
  | { phase: "success"; message: string }
  | { phase: "pending"; message: string }
  | { phase: "failed"; message: string }
  | { phase: "cancelled"; message: string };

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.");

export function useBilling(initial: BillingOverview) {
  const [overview, setOverview] = useState(initial);
  const [checkout, setCheckout] = useState<CheckoutPhase>({ phase: "idle" });
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<{ cancelled: boolean } | null>(null);
  const checkoutInProgress = useRef(false);

  const refresh = useCallback(async () => {
    const next = await billingApi.overview();
    setOverview(next);
    return next;
  }, []);

  useEffect(() => () => {
    if (pollRef.current) pollRef.current.cancelled = true;
  }, []);

  /** After a "pending" verify, wait for the matching payment to be confirmed by Razorpay. */
  const pollUntilConfirmed = useCallback(
    async (razorpayPaymentId: string) => {
      if (pollRef.current) pollRef.current.cancelled = true;
      const token = { cancelled: false };
      pollRef.current = token;
      for (let i = 0; i < 30 && !token.cancelled; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (token.cancelled) return;
        const next = await billingApi.overview().catch(() => null);
        if (!next) continue;
        setOverview(next);
        const payment = next.payments.find((p) => p.razorpayPaymentId === razorpayPaymentId);
        if (payment?.status === "captured") {
          setCheckout({ phase: "success", message: "Payment confirmed. Your credits have been added." });
          return;
        }
        if (payment?.status === "failed") {
          setCheckout({ phase: "failed", message: payment.errorDescription ?? "Razorpay reported that the payment failed. You can try again." });
          return;
        }
      }
      if (!token.cancelled) {
        setCheckout({
          phase: "pending",
          message: "Razorpay hasn't confirmed this payment yet. If money was taken, credits will appear here automatically — you can leave this page.",
        });
      }
    },
    [],
  );

  const runCheckout = useCallback(
    async (label: string, start: () => Promise<{ checkout: Parameters<typeof openCheckout>[0] }>, verify: (r: Awaited<ReturnType<typeof openCheckout>> & { kind: "success" }) => Promise<{ status: "confirmed" | "pending"; creditsGranted: number }>) => {
      if (checkoutInProgress.current) return;
      checkoutInProgress.current = true;
      setNotice(null);
      setCheckout({ phase: "starting", label });
      try {
        const { checkout: options } = await start();
        setCheckout({ phase: "open", label });
        const result = await openCheckout(options);
        if (result.kind === "dismissed") {
          setCheckout(
            result.lastError
              ? { phase: "failed", message: `${result.lastError} If your bank shows a debit, wait for the bank or Razorpay to resolve it before retrying.` }
              : { phase: "cancelled", message: "Checkout closed before payment was confirmed. Check billing history before trying again." },
          );
          return;
        }
        setCheckout({ phase: "verifying", label });
        const v = await verify(result);
        if (v.status === "confirmed") {
          setCheckout({
            phase: "success",
            message: v.creditsGranted > 0 ? `Payment confirmed. ${v.creditsGranted} credits added.` : "Payment confirmed.",
          });
          try {
            await refresh();
          } catch {
            setNotice({ tone: "info", text: "Payment is confirmed, but your balance couldn't refresh. Reload this page to see the updated credits." });
          }
        } else {
          setCheckout({ phase: "pending", message: "Payment received by Razorpay. Waiting for confirmation…" });
          void pollUntilConfirmed(result.response.razorpay_payment_id);
        }
      } catch (err) {
        setCheckout({ phase: "failed", message: message(err) });
        await refresh().catch(() => undefined);
      } finally {
        checkoutInProgress.current = false;
      }
    },
    [pollUntilConfirmed, refresh],
  );

  const buyPack = useCallback(
    (packId: string, packName: string) =>
      runCheckout(
        `Buying ${packName}`,
        () => billingApi.createOrder(packId, crypto.randomUUID()),
        (r) =>
          billingApi.verifyOrder({
            razorpay_order_id: r.response.razorpay_order_id ?? "",
            razorpay_payment_id: r.response.razorpay_payment_id,
            razorpay_signature: r.response.razorpay_signature,
          }),
      ),
    [runCheckout],
  );

  const subscribe = useCallback(
    (planId: string, planName: string) =>
      runCheckout(
        `Subscribing to ${planName}`,
        () => billingApi.subscribe(planId),
        (r) =>
          billingApi.verifySubscription({
            razorpay_subscription_id: r.response.razorpay_subscription_id ?? "",
            razorpay_payment_id: r.response.razorpay_payment_id,
            razorpay_signature: r.response.razorpay_signature,
          }),
      ),
    [runCheckout],
  );

  const act = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true);
      setNotice(null);
      try {
        const text = await fn();
        await refresh();
        setNotice({ tone: "success", text });
      } catch (err) {
        setNotice({ tone: "error", text: message(err) });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const cancel = useCallback(
    () =>
      act(async () => {
        const s = await billingApi.cancel(true);
        return s.currentEnd
          ? `Cancelled. Your plan stays active until ${new Date(s.currentEnd).toLocaleDateString("en-IN", { dateStyle: "long" })} and won't renew.`
          : "Cancelled. Your plan won't renew.";
      }),
    [act],
  );

  const changePlan = useCallback(
    (planId: string) =>
      act(async () => {
        const r = await billingApi.changePlan(planId);
        return r.message;
      }),
    [act],
  );

  return {
    overview,
    checkout,
    notice,
    busy: busy || ["starting", "open", "verifying"].includes(checkout.phase),
    buyPack,
    subscribe,
    cancel,
    changePlan,
    dismissCheckout: () => setCheckout({ phase: "idle" }),
  };
}

"use client";

import type {
  BillingOverview,
  ChangePlanResponse,
  CreateOrderResponse,
  CreateSubscriptionResponse,
  SubscriptionView,
  VerifyOrderRequest,
  VerifyResponse,
  VerifySubscriptionRequest,
} from "@/lib/billing-types";
import type { RefundableImage, RefundRequestView, TicketView } from "@/lib/support-types";
import { ApiError } from "@/features/studio/api-client";

export { ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_error", "You appear to be offline. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError((body?.error?.code as never) ?? "internal_error", body?.error?.message ?? "Something went wrong. Please try again.", res.status);
  }
  return (await res.json()) as T;
}

const post = (b: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(b) });

export const billingApi = {
  overview: () => call<BillingOverview>("/api/billing/overview"),
  createOrder: (packId: string, idempotencyKey: string) => call<CreateOrderResponse>("/api/billing/orders", post({ packId, idempotencyKey })),
  verifyOrder: (b: VerifyOrderRequest) => call<VerifyResponse>("/api/billing/orders/verify", post(b)),
  subscribe: (planId: string) => call<CreateSubscriptionResponse>("/api/billing/subscriptions", post({ planId })),
  verifySubscription: (b: VerifySubscriptionRequest) => call<VerifyResponse>("/api/billing/subscriptions/verify", post(b)),
  cancel: (atCycleEnd: boolean) => call<SubscriptionView>("/api/billing/subscriptions/cancel", post({ atCycleEnd })),
  changePlan: (planId: string) => call<ChangePlanResponse>("/api/billing/subscriptions/change-plan", post({ planId })),
  receiptUrl: (paymentId: string) => `/api/billing/payments/${paymentId}/receipt`,
  createRefundRequest: (imageIds: string[], reason: string) =>
    call<{ requests: RefundRequestView[]; images: RefundableImage[] }>("/api/refund-requests", post({ imageIds, reason })),
  createTicket: (subject: string, description: string) => call<{ tickets: TicketView[] }>("/api/support-tickets", post({ subject, description })),
};

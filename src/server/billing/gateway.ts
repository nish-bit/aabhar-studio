
import Razorpay from "razorpay";

/**
 * Payment gateway port.
 * The billing service talks to this interface, while production uses the
 * official Razorpay SDK and tests can use an in-memory fake.
 */

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
}

export interface GatewayPayment {
  id: string;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  order_id: string | null;
  subscription_id?: string | null;
  invoice_id?: string | null;
  method: string | null;
  captured: boolean;
  amount_refunded: number;
  error_code: string | null;
  error_description: string | null;
  created_at: number;
  notes: Record<string, string>;
}

export interface GatewaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  paid_count: number;
  short_url: string | null;
  notes: Record<string, string>;
}

export interface GatewayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "GatewayError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Network failures, rate limits, and server errors may be retried. */
  get transient(): boolean {
    return (
      this.statusCode === null ||
      this.statusCode === 429 ||
      this.statusCode >= 500
    );
  }
}

export interface PaymentGateway {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;

  fetchPayment(paymentId: string): Promise<GatewayPayment>;

  capturePayment(
    paymentId: string,
    amountPaise: number,
  ): Promise<GatewayPayment>;

  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;

  createPlan(input: {
    name: string;
    amountPaise: number;
    description: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;

  createSubscription(input: {
    planId: string;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<GatewaySubscription>;

  fetchSubscription(
    subscriptionId: string,
  ): Promise<GatewaySubscription>;

  cancelSubscription(
    subscriptionId: string,
    atCycleEnd: boolean,
  ): Promise<GatewaySubscription>;

  /** Schedules a plan change at the end of the current billing cycle. */
  updateSubscriptionPlan(
    subscriptionId: string,
    planId: string,
  ): Promise<GatewaySubscription>;
}

/* ------------------------------------------------------------------ */
/* Error handling                                                      */
/* ------------------------------------------------------------------ */

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Loose;
  }

  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function numericStatus(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

/**
 * Extract useful information from common Razorpay SDK, HTTP, and network
 * error formats without logging request headers or credentials.
 */
function toError(err: unknown): GatewayError {
  if (err instanceof GatewayError) {
    return err;
  }

  const root = asObject(err);
  const response = asObject(root?.response);
  const responseData = asObject(response?.data);

  const rootError = asObject(root?.error);
  const responseError = asObject(responseData?.error);

  const statusCode = numericStatus(
    root?.statusCode,
    root?.status,
    response?.status,
  );

  const code =
    nonEmptyString(rootError?.code) ??
    nonEmptyString(responseError?.code) ??
    nonEmptyString(root?.code) ??
    nonEmptyString(responseData?.code);

  const message =
    nonEmptyString(rootError?.description) ??
    nonEmptyString(responseError?.description) ??
    nonEmptyString(rootError?.reason) ??
    nonEmptyString(responseError?.reason) ??
    nonEmptyString(responseData?.description) ??
    nonEmptyString(root?.message) ??
    nonEmptyString(responseData?.message) ??
    "Payment gateway request failed";

  return new GatewayError(message, statusCode, code);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    throw toError(err);
  }
}

/* ------------------------------------------------------------------ */
/* Normalization helpers                                               */
/* ------------------------------------------------------------------ */

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : null;

  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
};

const notes = (value: unknown): Record<string, string> => {
  const object = asObject(value);

  if (!object) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [key, String(item)]),
  );
};

export function normalizePayment(p: Loose): GatewayPayment {
  return {
    id: String(p.id ?? ""),
    amount: num(p.amount) ?? 0,
    currency: String(p.currency ?? ""),
    status: String(p.status ?? ""),
    order_id: str(p.order_id),
    subscription_id: str(p.subscription_id),
    invoice_id: str(p.invoice_id),
    method: str(p.method),
    captured: p.captured === true || p.captured === 1,
    amount_refunded: num(p.amount_refunded) ?? 0,
    error_code: str(p.error_code),
    error_description: str(p.error_description),
    created_at: num(p.created_at) ?? 0,
    notes: notes(p.notes),
  };
}

export function normalizeSubscription(
  s: Loose,
): GatewaySubscription {
  return {
    id: String(s.id ?? ""),
    plan_id: String(s.plan_id ?? ""),
    status: String(s.status ?? ""),
    current_start: num(s.current_start),
    current_end: num(s.current_end),
    charge_at: num(s.charge_at),
    paid_count: num(s.paid_count) ?? 0,
    short_url: str(s.short_url),
    notes: notes(s.notes),
  };
}

/* ------------------------------------------------------------------ */
/* Razorpay adapter                                                    */
/* ------------------------------------------------------------------ */

/**
 * Production adapter for the official `razorpay` SDK.
 *
 * Server-side only. Never instantiate this class in client-side code
 * because it uses the Razorpay key secret.
 */
export class RazorpayGateway implements PaymentGateway {
  private readonly rzp: Razorpay;

  constructor(keyId: string, keySecret: string) {
    if (!keyId?.trim() || !keySecret?.trim()) {
      throw new Error(
        "Razorpay credentials are missing. Check server environment variables.",
      );
    }

    this.rzp = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  async createOrder(
    input: Parameters<PaymentGateway["createOrder"]>[0],
  ): Promise<GatewayOrder> {
    const result = (await call(() =>
      this.rzp.orders.create({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes,
        payment_capture: true,
      }),
    )) as unknown as Loose;

    return {
      id: String(result.id ?? ""),
      amount: num(result.amount) ?? 0,
      currency: String(result.currency ?? ""),
      status: String(result.status ?? ""),
      receipt: str(result.receipt),
    };
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const result = await call(() =>
      this.rzp.payments.fetch(paymentId),
    );

    return normalizePayment(result as unknown as Loose);
  }

  async capturePayment(
    paymentId: string,
    amountPaise: number,
  ): Promise<GatewayPayment> {
    const result = await call(() =>
      this.rzp.payments.capture(paymentId, amountPaise, "INR"),
    );

    return normalizePayment(result as unknown as Loose);
  }

  async fetchOrderPayments(
    orderId: string,
  ): Promise<GatewayPayment[]> {
    const result = (await call(() =>
      this.rzp.orders.fetchPayments(orderId),
    )) as unknown as { items?: Loose[] };

    return Array.isArray(result.items)
      ? result.items.map(normalizePayment)
      : [];
  }

  async createPlan(
    input: Parameters<PaymentGateway["createPlan"]>[0],
  ): Promise<{ id: string }> {
    const result = (await call(() =>
      this.rzp.plans.create({
        period: "monthly",
        interval: 1,
        item: {
          name: input.name,
          amount: input.amountPaise,
          currency: "INR",
          description: input.description,
        },
        notes: input.notes,
      }),
    )) as unknown as Loose;

    const id = str(result.id);

    if (!id) {
      throw new GatewayError(
        "Razorpay returned a plan response without an ID.",
        null,
        null,
      );
    }

    return { id };
  }

  async createSubscription(
    input: Parameters<PaymentGateway["createSubscription"]>[0],
  ): Promise<GatewaySubscription> {
    const result = (await call(() =>
      this.rzp.subscriptions.create({
        plan_id: input.planId,
        total_count: input.totalCount,
        customer_notify: 1,
        notes: input.notes,
      }),
    )) as unknown as Loose;

    return normalizeSubscription(result);
  }

  async fetchSubscription(
    subscriptionId: string,
  ): Promise<GatewaySubscription> {
    const result = await call(() =>
      this.rzp.subscriptions.fetch(subscriptionId),
    );

    return normalizeSubscription(result as unknown as Loose);
  }

  async cancelSubscription(
    subscriptionId: string,
    atCycleEnd: boolean,
  ): Promise<GatewaySubscription> {
    const result = await call(() =>
      this.rzp.subscriptions.cancel(subscriptionId, atCycleEnd),
    );

    return normalizeSubscription(result as unknown as Loose);
  }

  async updateSubscriptionPlan(
    subscriptionId: string,
    planId: string,
  ): Promise<GatewaySubscription> {
    const result = await call(() =>
      this.rzp.subscriptions.update(subscriptionId, {
        plan_id: planId,
        schedule_change_at: "cycle_end",
      }),
    );

    return normalizeSubscription(result as unknown as Loose);
  }
}

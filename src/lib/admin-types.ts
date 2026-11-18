/**
 * View models for the admin dashboard. They deliberately carry metadata
 * only: no image URLs or storage paths, no customer prompt text, no raw
 * payment payloads, and never any secret.
 */
export type AdminRole = "admin" | "support";

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  disabledAt: string | null;
  shopId: string | null;
  shopName: string | null;
  role: "owner" | "editor" | "viewer" | null;
  balance: number;
  planId: string | null;
  subscriptionStatus: string | null;
  jobs30d: number;
  adminRole: AdminRole | null;
}

export interface AdminUserDetail extends AdminUserRow {
  disabledReason: string | null;
  disabledByEmail: string | null;
  entitlementState: string;
  catalogues: { active: number; deleted: number; items: number; exports: number; lastUpdatedAt: string | null };
  uploads: { total: number; rejected: number };
  jobs: { total: number; succeeded: number; failed: number; costUsdMicros: number };
  recentJobs: AdminJobRow[];
  recentPayments: AdminPaymentRow[];
  recentLedger: AdminLedgerRow[];
  grants: { id: string; source: string; amount: number; remaining: number; expiresAt: string | null }[];
  audit: AdminAuditRow[];
}

export interface AdminJobRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  shopId: string;
  shopName: string | null;
  requesterEmail: string | null;
  presetSlug: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  errorCode: string | null;
  creditCost: number;
  refunded: boolean;
  costUsdMicros: number | null;
  provider: string;
  model: string;
  attempts: number;
  durationMs: number | null;
}

export interface AdminJobDetail extends AdminJobRow {
  errorMessage: string | null;
  presetVersion: number;
  hasInstructions: boolean;
  instructionsLength: number;
  providerRequestId: string | null;
  startedAt: string | null;
  attemptList: {
    attemptNo: number;
    outcome: string;
    errorCode: string | null;
    latencyMs: number | null;
    costUsdMicros: number | null;
    providerRequestId: string | null;
    createdAt: string;
  }[];
  retry: { eligible: boolean; reason: string; retriedAs: string | null };
}

export interface AdminErrorSummary {
  failedByCode: { errorCode: string; count: number; retryable: boolean; lastAt: string }[];
  stuckJobs: number;
  queuedOver10m: number;
  webhookFailures: { eventId: string; type: string; attempts: number; lastError: string | null; receivedAt: string; processed: boolean }[];
  rejectedUploads: { reason: string; count: number }[];
  retryableJobs: AdminJobRow[];
}

export interface AdminPaymentRow {
  id: string;
  createdAt: string;
  shopId: string;
  shopName: string | null;
  kind: "pack" | "subscription";
  description: string;
  amountPaise: number;
  amountRefundedPaise: number;
  status: string;
  method: string | null;
  errorCode: string | null;
  creditsGranted: number;
  mode: "test" | "live" | null;
  razorpayPaymentId: string;
}

export interface AdminSubscriptionRow {
  id: string;
  shopId: string;
  shopName: string | null;
  planId: string;
  status: string;
  mode: "test" | "live";
  amountPaise: number;
  currentEnd: string | null;
  cancelAtCycleEnd: boolean;
  scheduledPlanId: string | null;
  createdAt: string;
  razorpaySubscriptionId: string;
}

export interface AdminWebhookRow {
  eventId: string;
  type: string;
  mode: "test" | "live";
  receivedAt: string;
  eventCreatedAt: string | null;
  attempts: number;
  processedAt: string | null;
  outcome: string | null;
  lastError: string | null;
  /** Ids and amounts extracted server-side. The raw payload (which holds customer contact details) is never sent. */
  summary: { paymentId: string | null; subscriptionId: string | null; refundId: string | null; amountPaise: number | null; status: string | null };
}

/** Admin-only billing health. Counts, timestamps, Razorpay ids and yes/no flags; never secrets or customer contact details. */
export interface AdminBillingHealth {
  checkedAt: string;
  /** Razorpay keys are present and allowed in this mode (live keys need BILLING_LIVE_APPROVED). */
  paymentsEnabled: boolean;
  mode: "test" | "live" | null;
  webhookSecretConfigured: boolean;
  lastProcessedWebhook: { eventType: string; processedAt: string; outcome: string | null } | null;
  webhooks: {
    /** Received, not processed, no error yet (in flight, or Razorpay will retry). */
    pending: number;
    /** Received, not processed, last attempt failed. */
    failed: number;
    oldestUnprocessedAt: string | null;
  };
  unpaidOrders: {
    /** Unpaid orders created more than an hour ago (most are abandoned checkouts). */
    olderThanOneHour: number;
    /** Of those, the ones reconciliation still checks with Razorpay (younger than 72 hours). */
    withinReconcileWindow: number;
    recent: { razorpayOrderId: string; packId: string; amountPaise: number; mode: "test" | "live"; createdAt: string }[];
  };
  /** null when no run has been recorded yet; "unavailable" when the run history table doesn't exist yet. */
  lastReconcileRun:
    | {
        startedAt: string;
        finishedAt: string;
        ok: boolean;
        expiredGrants: number;
        ordersChecked: number;
        ordersConfirmed: number;
        ordersFailed: number;
        error: string | null;
      }
    | null
    | "unavailable";
}

export interface AdminLedgerRow {
  id: string;
  createdAt: string;
  shopId: string;
  shopName: string | null;
  type: string;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  jobId: string | null;
}

export interface AdminAuditRow {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

export interface AdminPlanView {
  id: string;
  name: string;
  isPaid: boolean;
  monthlyCredits: number;
  limits: {
    maxActiveJobs: number;
    dailyGenerations: number;
    maxCatalogues: number;
    maxCatalogueItems: number;
    presets: "all" | string[];
  };
  overridden: boolean;
  overriddenAt: string | null;
  configMonthlyPricePaise: number | null;
  prices: { mode: "test" | "live"; amountPaise: number; razorpayPlanId: string; active: boolean }[];
  activeSubscribers: number;
}

export interface AdminPresetView {
  slug: string;
  name: string;
  enabled: boolean;
  creditCost: number;
  defaultCreditCost: number;
  version: number;
  jobs30d: number;
  failureRate30d: number | null;
}

export interface AdminConfigView {
  plans: AdminPlanView[];
  trial: { credits: number; validityDays: number };
  packs: { id: string; name: string; credits: number; pricePaise: number; validityDays: number }[];
  presets: AdminPresetView[];
  pricesApproved: boolean;
  billingMode: "test" | "live" | null;
}

export interface AdminMetrics {
  generatedAt: string;
  users: { total: number; new7d: number; new30d: number; disabled: number; activeShops30d: number };
  revenue: {
    mode: "test" | "live";
    gross30dPaise: number;
    refunded30dPaise: number;
    grossAllTimePaise: number;
    mrrPaise: number;
    monthly: { month: string; grossPaise: number; refundedPaise: number }[];
  }[];
  subscriptions: { planId: string; mode: "test" | "live"; active: number; pastDue: number }[];
  jobs: {
    total30d: number;
    succeeded30d: number;
    failed30d: number;
    costUsdMicros30d: number;
    daily: { day: string; succeeded: number; failed: number; costUsdMicros: number }[];
  };
  credits30d: { type: string; total: number }[];
}

export interface AdminMarketingSummary {
  registeredUsers: number;
  subscribed: number;
  unsubscribed: number;
  pending: number;
  /** Never opted in (no consent record). */
  notOptedIn: number;
  /** Subscribed, not suppressed, account active: who an export or campaign would reach. */
  eligible: number;
}

export interface AdminSubscriberRow {
  userId: string;
  email: string | null;
  signedUpAt: string;
  status: "subscribed" | "unsubscribed" | "pending" | "none";
  consentAt: string | null;
  consentSource: string | null;
  unsubscribedAt: string | null;
  suppressionReason: string | null;
  disabled: boolean;
}

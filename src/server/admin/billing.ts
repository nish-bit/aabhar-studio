import { z } from "zod";

import type { AdminLedgerRow, AdminPaymentRow, AdminSubscriptionRow, AdminWebhookRow, Page } from "@/lib/admin-types";
import { iso } from "@/server/billing/repository";

import type { AdminDeps } from "./deps-types";
import type { AdminContext } from "./guard";
import { isUuid, likeEscape, pageOf, Where, type PageInput } from "./pagination";

/**
 * Read-only billing views. Card data is never stored, and raw webhook
 * payloads (which hold customer email and phone) are never returned:
 * only ids, amounts and statuses extracted on the server.
 */

const shopSearch = (w: Where, q: string | null | undefined, shopCol: string, extraIdCols: string[] = []) => {
  const t = q?.trim();
  if (!t) return;
  if (isUuid(t)) w.add(`(${[shopCol, ...extraIdCols].map((c) => `${c} = ?::uuid`).join(" or ")})`, ...[shopCol, ...extraIdCols].map(() => t));
  else w.add(`s.name ilike ?`, likeEscape(t));
};

/* -------------------------------------------------------------- payments */

export const paymentFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["created", "authorized", "captured", "failed", "refunded", "partially_refunded"]).optional().nullable(),
  kind: z.enum(["pack", "subscription"]).optional().nullable(),
  mode: z.enum(["test", "live"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type PaymentFilter = z.infer<typeof paymentFilterSchema> & PageInput & { shopId?: string };

const PAY_FROM = `from public.billing_payments p join public.shops s on s.id = p.shop_id
  left join public.billing_orders o on o.id = p.order_id
  left join public.billing_subscriptions bs on bs.id = p.subscription_id`;

export async function listPayments(deps: AdminDeps, _ctx: AdminContext, f: PaymentFilter): Promise<Page<AdminPaymentRow>> {
  const w = new Where();
  if (f.shopId) w.add("p.shop_id = ?::uuid", f.shopId);
  const q = f.q?.trim();
  if (q && /^pay_[A-Za-z0-9]+$/.test(q)) w.add("p.razorpay_payment_id = ?", q);
  else shopSearch(w, q, "p.shop_id", ["p.id"]);
  if (f.status) w.add("p.status = ?", f.status);
  if (f.kind) w.add("p.kind = ?", f.kind);
  if (f.mode) w.add("coalesce(o.mode, bs.mode) = ?", f.mode);
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminPaymentRow>(
      `select p.id, p.created_at as "createdAt", p.shop_id as "shopId", s.name as "shopName", p.kind, p.description,
              p.amount_paise::int as "amountPaise", p.amount_refunded_paise::int as "amountRefundedPaise", p.status, p.method,
              p.error_code as "errorCode", p.credits_granted as "creditsGranted", coalesce(o.mode, bs.mode) as mode,
              p.razorpay_payment_id as "razorpayPaymentId"
         ${PAY_FROM} ${w.sql} order by p.created_at desc, p.id limit ${limit} offset ${offset}`,
      w.params,
    ),
    deps.db.query<{ n: number }>(`select count(*)::int as n ${PAY_FROM} ${w.sql}`, w.params),
  ]);
  return { items: rows.map((r) => ({ ...r, createdAt: iso(r.createdAt)! })), page, pageSize, total: count[0]?.n ?? 0 };
}

/* --------------------------------------------------------- subscriptions */

export const subscriptionFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["created", "authenticated", "active", "pending", "halted", "paused", "cancelled", "completed", "expired"]).optional().nullable(),
  plan: z.string().trim().max(40).optional().nullable(),
  mode: z.enum(["test", "live"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type SubscriptionFilter = z.infer<typeof subscriptionFilterSchema> & PageInput;

const SUB_FROM = `from public.billing_subscriptions b join public.shops s on s.id = b.shop_id join public.plan_prices pp on pp.id = b.price_id`;

export async function listSubscriptions(deps: AdminDeps, _ctx: AdminContext, f: SubscriptionFilter): Promise<Page<AdminSubscriptionRow>> {
  const w = new Where();
  const q = f.q?.trim();
  if (q && /^sub_[A-Za-z0-9]+$/.test(q)) w.add("b.razorpay_subscription_id = ?", q);
  else shopSearch(w, q, "b.shop_id", ["b.id"]);
  if (f.status) w.add("b.status = ?", f.status);
  if (f.plan) w.add("b.plan_id = ?", f.plan);
  if (f.mode) w.add("b.mode = ?", f.mode);
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminSubscriptionRow>(
      `select b.id, b.shop_id as "shopId", s.name as "shopName", b.plan_id as "planId", b.status, b.mode, pp.amount_paise::int as "amountPaise",
              b.current_end as "currentEnd", b.cancel_at_cycle_end as "cancelAtCycleEnd", b.scheduled_plan_id as "scheduledPlanId",
              b.created_at as "createdAt", b.razorpay_subscription_id as "razorpaySubscriptionId"
         ${SUB_FROM} ${w.sql} order by b.created_at desc, b.id limit ${limit} offset ${offset}`,
      w.params,
    ),
    deps.db.query<{ n: number }>(`select count(*)::int as n ${SUB_FROM} ${w.sql}`, w.params),
  ]);
  return { items: rows.map((r) => ({ ...r, createdAt: iso(r.createdAt)!, currentEnd: iso(r.currentEnd) })), page, pageSize, total: count[0]?.n ?? 0 };
}

/* -------------------------------------------------------------- webhooks */

export const webhookFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  type: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional().nullable(),
  state: z.enum(["processed", "failed", "pending"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type WebhookFilter = z.infer<typeof webhookFilterSchema> & PageInput;

export async function listWebhookEvents(deps: AdminDeps, _ctx: AdminContext, f: WebhookFilter): Promise<Page<AdminWebhookRow>> {
  const w = new Where();
  const q = f.q?.trim();
  if (q) {
    w.add(
      `(event_id = ? or payload #>> '{payload,payment,entity,id}' = ? or payload #>> '{payload,subscription,entity,id}' = ? or payload #>> '{payload,refund,entity,id}' = ?)`,
      q, q, q, q,
    );
  }
  if (f.type) w.add("event_type = ?", f.type);
  if (f.state === "processed") w.add("processed_at is not null");
  if (f.state === "failed") w.add("processed_at is null and last_error is not null");
  if (f.state === "pending") w.add("processed_at is null and last_error is null");
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminWebhookRow & { pId: string | null; sId: string | null; rId: string | null; amt: string | null; st: string | null }>(
      `select event_id as "eventId", event_type as type, mode, received_at as "receivedAt", event_created_at as "eventCreatedAt", attempts,
              processed_at as "processedAt", outcome, last_error as "lastError",
              payload #>> '{payload,payment,entity,id}' as "pId",
              payload #>> '{payload,subscription,entity,id}' as "sId",
              payload #>> '{payload,refund,entity,id}' as "rId",
              coalesce(payload #>> '{payload,refund,entity,amount}', payload #>> '{payload,payment,entity,amount}') as amt,
              coalesce(payload #>> '{payload,refund,entity,status}', payload #>> '{payload,subscription,entity,status}', payload #>> '{payload,payment,entity,status}') as st
         from public.billing_webhook_events ${w.sql} order by received_at desc, id desc limit ${limit} offset ${offset}`,
      w.params,
    ),
    deps.db.query<{ n: number }>(`select count(*)::int as n from public.billing_webhook_events ${w.sql}`, w.params),
  ]);
  return {
    items: rows.map((r) => ({
      eventId: r.eventId,
      type: r.type,
      mode: r.mode,
      receivedAt: iso(r.receivedAt)!,
      eventCreatedAt: iso(r.eventCreatedAt),
      attempts: r.attempts,
      processedAt: iso(r.processedAt),
      outcome: r.outcome,
      lastError: r.lastError,
      summary: { paymentId: r.pId, subscriptionId: r.sId, refundId: r.rId, amountPaise: r.amt === null ? null : Number(r.amt), status: r.st },
    })),
    page,
    pageSize,
    total: count[0]?.n ?? 0,
  };
}

/* ---------------------------------------------------------------- ledger */

export const ledgerFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  type: z.enum(["grant", "debit", "refund", "adjustment", "expiry"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type LedgerFilter = z.infer<typeof ledgerFilterSchema> & PageInput & { shopId?: string };

const LEDGER_FROM = `from public.credit_ledger l join public.shops s on s.id = l.shop_id`;

export async function listLedger(deps: AdminDeps, _ctx: AdminContext, f: LedgerFilter): Promise<Page<AdminLedgerRow>> {
  const w = new Where();
  if (f.shopId) w.add("l.shop_id = ?::uuid", f.shopId);
  shopSearch(w, f.q, "l.shop_id", ["l.job_id"]);
  if (f.type) w.add("l.entry_type = ?::public.ledger_type", f.type);
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminLedgerRow & { id: string | number }>(
      `select l.id::text as id, l.created_at as "createdAt", l.shop_id as "shopId", s.name as "shopName", l.entry_type::text as type,
              l.amount, l.balance_after as "balanceAfter", l.reason, l.job_id as "jobId"
         ${LEDGER_FROM} ${w.sql} order by l.id desc limit ${limit} offset ${offset}`,
      w.params,
    ),
    deps.db.query<{ n: number }>(`select count(*)::int as n ${LEDGER_FROM} ${w.sql}`, w.params),
  ]);
  return { items: rows.map((r) => ({ ...r, id: String(r.id), createdAt: iso(r.createdAt)! })), page, pageSize, total: count[0]?.n ?? 0 };
}

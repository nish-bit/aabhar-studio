import type { BillingMode, CreditGrantView, FreeTrialView, LedgerEntryView, SubscriptionStatus } from "@/lib/billing-types";
import type { Db } from "@/server/db/sql";

/**
 * SQL for billing. Runs on a direct Postgres connection with server
 * privileges (never the browser's). Credit balances only change through the
 * SECURITY DEFINER functions in the billing migration.
 */

export const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
export const fromUnix = (s: number | null | undefined): Date | null => (s ? new Date(s * 1000) : null);

export interface PriceRow {
  id: string;
  planId: string;
  mode: BillingMode;
  amountPaise: number;
  razorpayPlanId: string;
  active: boolean;
}

export interface OrderRow {
  id: string;
  shopId: string;
  packId: string;
  credits: number;
  validityDays: number;
  amountPaise: number;
  currency: string;
  mode: BillingMode;
  razorpayOrderId: string;
  status: "created" | "paid";
  createdAt: string;
}

export interface SubscriptionRow {
  id: string;
  shopId: string;
  planId: string;
  priceId: string;
  mode: BillingMode;
  razorpaySubscriptionId: string;
  status: SubscriptionStatus;
  currentStart: string | null;
  currentEnd: string | null;
  cancelAtCycleEnd: boolean;
  scheduledPlanId: string | null;
  endedAt: string | null;
  shortUrl: string | null;
  lastEventAt: string | null;
  createdAt: string;
  amountPaise: number;
}

export interface PaymentRow {
  id: string;
  shopId: string;
  razorpayPaymentId: string;
  kind: "pack" | "subscription";
  orderId: string | null;
  subscriptionId: string | null;
  amountPaise: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  amountRefundedPaise: number;
  creditsGranted: number;
  grantId: string | null;
  description: string;
  capturedAt: string | null;
  createdAt: string;
}

const SUB_COLS = `s.id, s.shop_id as "shopId", s.plan_id as "planId", s.price_id as "priceId", s.mode,
  s.razorpay_subscription_id as "razorpaySubscriptionId", s.status, s.current_start as "currentStart", s.current_end as "currentEnd",
  s.cancel_at_cycle_end as "cancelAtCycleEnd", s.scheduled_plan_id as "scheduledPlanId", s.ended_at as "endedAt",
  s.short_url as "shortUrl", s.last_event_at as "lastEventAt", s.created_at as "createdAt", p.amount_paise::int as "amountPaise"`;

const PAY_COLS = `id, shop_id as "shopId", razorpay_payment_id as "razorpayPaymentId", kind, order_id as "orderId",
  subscription_id as "subscriptionId", amount_paise::int as "amountPaise", currency, status, method, error_code as "errorCode",
  error_description as "errorDescription", amount_refunded_paise::int as "amountRefundedPaise", credits_granted as "creditsGranted",
  grant_id as "grantId", description, captured_at as "capturedAt", created_at as "createdAt"`;

const ORDER_COLS = `id, shop_id as "shopId", pack_id as "packId", credits, validity_days as "validityDays", amount_paise::int as "amountPaise",
  currency, mode, razorpay_order_id as "razorpayOrderId", status, created_at as "createdAt"`;

function normSub(r: SubscriptionRow): SubscriptionRow {
  return { ...r, currentStart: iso(r.currentStart), currentEnd: iso(r.currentEnd), endedAt: iso(r.endedAt), lastEventAt: iso(r.lastEventAt), createdAt: iso(r.createdAt)! };
}
function normPay(r: PaymentRow): PaymentRow {
  return { ...r, capturedAt: iso(r.capturedAt), createdAt: iso(r.createdAt)! };
}
function normOrder(r: OrderRow): OrderRow {
  return { ...r, createdAt: iso(r.createdAt)! };
}

/** Payment status only moves forward, so late or duplicate events can't regress it. */
const PAYMENT_RANK = `case $S when 'created' then 0 when 'failed' then 1 when 'authorized' then 2 when 'captured' then 3 when 'partially_refunded' then 4 when 'refunded' then 5 else 0 end`;
const rank = (col: string) => PAYMENT_RANK.replace("$S", col);

export class BillingRepository {
  constructor(readonly db: Db) {}

  withTx<T>(fn: (repo: BillingRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new BillingRepository(tx)));
  }

  /* ------------------------------------------------------------ members */
  async membership(userId: string): Promise<{ shopId: string; role: "owner" | "editor" | "viewer" } | null> {
    const rows = await this.db.query<{ shopId: string; role: "owner" | "editor" | "viewer" }>(
      `select shop_id as "shopId", role::text as role from public.shop_members where user_id = $1 order by created_at limit 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async businessProfile(shopId: string) {
    const rows = await this.db.query<{ name: string; businessName: string | null; email: string | null; phone: string | null; address: string | null }>(
      `select s.name, b.business_name as "businessName", b.email, b.phone, b.address
         from public.shops s left join public.business_profiles b on b.shop_id = s.id where s.id = $1`,
      [shopId],
    );
    return rows[0] ?? null;
  }

  /* ------------------------------------------------------- plans & packs */
  async upsertPlan(p: { id: string; name: string; monthlyCredits: number; limits: unknown; isPaid: boolean; sortOrder: number }) {
    await this.db.query(
      `insert into public.plans (id, name, monthly_credits, limits, is_paid, sort_order, active, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, true, now())
       on conflict (id) do update set name = excluded.name, monthly_credits = excluded.monthly_credits, limits = excluded.limits,
         is_paid = excluded.is_paid, sort_order = excluded.sort_order, active = true, updated_at = now()
       where public.plans.overridden_at is null`,
      [p.id, p.name, p.monthlyCredits, JSON.stringify(p.limits), p.isPaid, p.sortOrder],
    );
  }

  async upsertPack(p: { id: string; name: string; credits: number; amountPaise: number; validityDays: number; sortOrder: number }) {
    await this.db.query(
      `insert into public.credit_packs (id, name, credits, amount_paise, validity_days, sort_order, active, updated_at)
       values ($1, $2, $3, $4, $5, $6, true, now())
       on conflict (id) do update set name = excluded.name, credits = excluded.credits, amount_paise = excluded.amount_paise,
         validity_days = excluded.validity_days, sort_order = excluded.sort_order, active = true, updated_at = now()`,
      [p.id, p.name, p.credits, p.amountPaise, p.validityDays, p.sortOrder],
    );
  }

  async deactivateMissingPacks(ids: string[]) {
    await this.db.query(`update public.credit_packs set active = false where not (id = any(string_to_array($1, ',')))`, [ids.join(",")]);
  }

  /** True when the pack is synced (active, same credits and price as the config); orders reference this row. */
  async packSynced(p: { id: string; credits: number; amountPaise: number }): Promise<boolean> {
    const rows = await this.db.query(
      `select 1 from public.credit_packs where id = $1 and active and credits = $2 and amount_paise = $3`,
      [p.id, p.credits, p.amountPaise],
    );
    return rows.length > 0;
  }

  async activePrice(planId: string, mode: BillingMode): Promise<PriceRow | null> {
    const rows = await this.db.query<PriceRow>(
      `select id, plan_id as "planId", mode, amount_paise::int as "amountPaise", razorpay_plan_id as "razorpayPlanId", active
         from public.plan_prices where plan_id = $1 and mode = $2 and active`,
      [planId, mode],
    );
    return rows[0] ?? null;
  }

  async priceByRazorpayPlanId(razorpayPlanId: string): Promise<PriceRow | null> {
    const rows = await this.db.query<PriceRow>(
      `select id, plan_id as "planId", mode, amount_paise::int as "amountPaise", razorpay_plan_id as "razorpayPlanId", active
         from public.plan_prices where razorpay_plan_id = $1`,
      [razorpayPlanId],
    );
    return rows[0] ?? null;
  }

  async insertPrice(p: { planId: string; mode: BillingMode; amountPaise: number; razorpayPlanId: string }) {
    await this.db.query(`update public.plan_prices set active = false where plan_id = $1 and mode = $2 and active`, [p.planId, p.mode]);
    await this.db.query(
      `insert into public.plan_prices (plan_id, mode, amount_paise, razorpay_plan_id) values ($1, $2, $3, $4)`,
      [p.planId, p.mode, p.amountPaise, p.razorpayPlanId],
    );
  }

  /* ------------------------------------------------------------- orders */
  async orderByKey(shopId: string, key: string): Promise<OrderRow | null> {
    const rows = await this.db.query<OrderRow>(`select ${ORDER_COLS} from public.billing_orders where shop_id = $1 and idempotency_key = $2`, [shopId, key]);
    return rows[0] ? normOrder(rows[0]) : null;
  }

  async orderByRazorpayId(razorpayOrderId: string): Promise<OrderRow | null> {
    const rows = await this.db.query<OrderRow>(`select ${ORDER_COLS} from public.billing_orders where razorpay_order_id = $1`, [razorpayOrderId]);
    return rows[0] ? normOrder(rows[0]) : null;
  }

  async insertOrder(o: {
    shopId: string; packId: string; credits: number; validityDays: number; amountPaise: number; mode: BillingMode;
    razorpayOrderId: string; idempotencyKey: string; userId: string;
  }): Promise<OrderRow> {
    const rows = await this.db.query<OrderRow>(
      `insert into public.billing_orders (shop_id, pack_id, credits, validity_days, amount_paise, mode, razorpay_order_id, idempotency_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${ORDER_COLS}`,
      [o.shopId, o.packId, o.credits, o.validityDays, o.amountPaise, o.mode, o.razorpayOrderId, o.idempotencyKey, o.userId],
    );
    return normOrder(rows[0]!);
  }

  async markOrderPaid(id: string) {
    await this.db.query(`update public.billing_orders set status = 'paid', paid_at = coalesce(paid_at, now()) where id = $1`, [id]);
  }

  async unpaidOrders(olderThanMinutes: number, newerThanHours: number): Promise<OrderRow[]> {
    const rows = await this.db.query<OrderRow>(
      `select ${ORDER_COLS} from public.billing_orders
        where status = 'created' and created_at < now() - make_interval(mins => $1) and created_at > now() - make_interval(hours => $2)
        order by created_at limit 50`,
      [olderThanMinutes, newerThanHours],
    );
    return rows.map(normOrder);
  }

  /* ------------------------------------------------------ subscriptions */
  async subscriptionByRazorpayId(id: string): Promise<SubscriptionRow | null> {
    const rows = await this.db.query<SubscriptionRow>(
      `select ${SUB_COLS} from public.billing_subscriptions s join public.plan_prices p on p.id = s.price_id where s.razorpay_subscription_id = $1`,
      [id],
    );
    return rows[0] ? normSub(rows[0]) : null;
  }

  async lockSubscription(id: string) {
    await this.db.query(`select 1 from public.billing_subscriptions where id = $1 for update`, [id]);
  }

  /** Newest subscription that isn't an abandoned checkout. */
  /** The shop's free trial grant: how many it got and how many are still usable. */
  async freeTrial(shopId: string): Promise<FreeTrialView | null> {
    // Trials granted under an older, larger allowance show the current limit
    // ("x / 2"); migration 20261104000100 already capped what they have left.
    const rows = await this.db.query<{ total: number; remaining: number; expiresAt: Date | string | null; expired: boolean }>(
      `select least(g.amount, coalesce(s.trial_credits, g.amount)) as total,
              least(g.remaining, coalesce(s.trial_credits, g.remaining)) as remaining,
              g.expires_at as "expiresAt", coalesce(g.expires_at <= now(), false) as expired
         from public.credit_grants g left join public.billing_settings s on s.id
        where g.shop_id = $1 and g.source = 'trial' order by g.created_at limit 1`,
      [shopId],
    );
    const t = rows[0];
    return t ? { total: t.total, remaining: t.expired ? 0 : t.remaining, expiresAt: iso(t.expiresAt), expired: t.expired } : null;
  }

  /** Has this shop ever paid for a credit pack (even if later refunded)? Gates first-purchase-only packs. */
  async hasEverPaidPack(shopId: string): Promise<boolean> {
    const rows = await this.db.query(
      `select 1 from public.billing_payments where shop_id = $1 and kind = 'pack' and status in ('captured', 'partially_refunded', 'refunded') limit 1`,
      [shopId],
    );
    return rows.length > 0;
  }

  /** Has this shop paid for a credit pack (captured, and not fully refunded)? */
  async hasPackPurchase(shopId: string): Promise<boolean> {
    const rows = await this.db.query(
      `select 1 from public.billing_payments where shop_id = $1 and kind = 'pack' and status in ('captured', 'partially_refunded') limit 1`,
      [shopId],
    );
    return rows.length > 0;
  }

  async currentSubscription(shopId: string): Promise<SubscriptionRow | null> {
    const rows = await this.db.query<SubscriptionRow>(
      `select ${SUB_COLS} from public.billing_subscriptions s join public.plan_prices p on p.id = s.price_id
        where s.shop_id = $1 and s.status <> 'created' order by s.created_at desc limit 1`,
      [shopId],
    );
    return rows[0] ? normSub(rows[0]) : null;
  }

  async pendingCheckouts(shopId: string): Promise<SubscriptionRow[]> {
    const rows = await this.db.query<SubscriptionRow>(
      `select ${SUB_COLS} from public.billing_subscriptions s join public.plan_prices p on p.id = s.price_id
        where s.shop_id = $1 and s.status = 'created' order by s.created_at desc`,
      [shopId],
    );
    return rows.map(normSub);
  }

  async hasEverSubscribed(shopId: string): Promise<boolean> {
    const rows = await this.db.query(`select 1 from public.billing_subscriptions where shop_id = $1 and status <> 'created' limit 1`, [shopId]);
    return rows.length > 0;
  }

  async insertSubscription(s: {
    shopId: string; planId: string; priceId: string; mode: BillingMode; razorpaySubscriptionId: string;
    status: string; shortUrl: string | null; userId: string;
  }) {
    await this.db.query(
      `insert into public.billing_subscriptions (shop_id, plan_id, price_id, mode, razorpay_subscription_id, status, short_url, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [s.shopId, s.planId, s.priceId, s.mode, s.razorpaySubscriptionId, s.status, s.shortUrl, s.userId],
    );
  }

  /**
   * Applies Razorpay's view of a subscription, unless we've already applied
   * a newer event (webhooks can arrive out of order) or it would revive an
   * ended subscription. Returns false if skipped.
   */
  async applySubscriptionState(
    id: string,
    s: {
      status: string;
      currentStart: Date | null;
      currentEnd: Date | null;
      /** Webhook event time. null = state fetched from the API just now (applies without advancing the event clock). */
      eventAt: Date | null;
      planId?: string;
      priceId?: string;
      cancelAtCycleEnd?: boolean;
    },
  ): Promise<boolean> {
    const rows = await this.db.query(
      `update public.billing_subscriptions set
         status = $2,
         current_start = coalesce($3, current_start),
         current_end = coalesce($4, current_end),
         last_event_at = coalesce($5, last_event_at),
         plan_id = coalesce($6, plan_id),
         price_id = coalesce($7::uuid, price_id),
         scheduled_plan_id = case when $6::text is not null and $6::text = scheduled_plan_id then null else scheduled_plan_id end,
         cancel_at_cycle_end = coalesce($8, cancel_at_cycle_end),
         ended_at = case when $2 in ('cancelled', 'completed', 'expired') then coalesce(ended_at, now()) else ended_at end,
         updated_at = now()
       where id = $1
         and (last_event_at is null or $5::timestamptz is null or last_event_at <= $5)
         -- Cancelled, completed and expired subscriptions can't be restarted on Razorpay.
         and not (status in ('cancelled', 'completed', 'expired') and $2 not in ('cancelled', 'completed', 'expired'))
       returning id`,
      [id, s.status, s.currentStart, s.currentEnd, s.eventAt, s.planId ?? null, s.priceId ?? null, s.cancelAtCycleEnd ?? null],
    );
    return rows.length > 0;
  }

  async setScheduledPlan(id: string, planId: string | null) {
    await this.db.query(`update public.billing_subscriptions set scheduled_plan_id = $2, updated_at = now() where id = $1`, [id, planId]);
  }

  async setCancelAtCycleEnd(id: string, value: boolean) {
    await this.db.query(`update public.billing_subscriptions set cancel_at_cycle_end = $2, updated_at = now() where id = $1`, [id, value]);
  }

  async markCheckoutAbandoned(id: string) {
    await this.db.query(
      `update public.billing_subscriptions set status = 'cancelled', ended_at = now(), updated_at = now() where id = $1 and status = 'created'`,
      [id],
    );
  }

  /* ----------------------------------------------------------- payments */
  async paymentByRazorpayId(id: string): Promise<PaymentRow | null> {
    const rows = await this.db.query<PaymentRow>(`select ${PAY_COLS} from public.billing_payments where razorpay_payment_id = $1`, [id]);
    return rows[0] ? normPay(rows[0]) : null;
  }

  async paymentForShop(shopId: string, id: string): Promise<PaymentRow | null> {
    const rows = await this.db.query<PaymentRow>(`select ${PAY_COLS} from public.billing_payments where shop_id = $1 and id = $2`, [shopId, id]);
    return rows[0] ? normPay(rows[0]) : null;
  }

  async payments(shopId: string, limit = 50): Promise<PaymentRow[]> {
    const rows = await this.db.query<PaymentRow>(
      `select ${PAY_COLS} from public.billing_payments where shop_id = $1 order by created_at desc limit $2`,
      [shopId, limit],
    );
    return rows.map(normPay);
  }

  /**
   * Records a payment, or moves an existing one forward. Card details are
   * never stored — only the method name (card, upi, netbanking…).
   */
  async upsertPayment(p: {
    shopId: string; razorpayPaymentId: string; kind: "pack" | "subscription"; orderId: string | null; subscriptionId: string | null;
    amountPaise: number; currency: string; status: PaymentRow["status"]; method: string | null; errorCode: string | null;
    errorDescription: string | null; description: string;
  }): Promise<PaymentRow> {
    const rows = await this.db.query<PaymentRow>(
      `insert into public.billing_payments (shop_id, razorpay_payment_id, kind, order_id, subscription_id, amount_paise, currency, status,
         method, error_code, error_description, description, captured_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $8 = 'captured' then now() end)
       on conflict (razorpay_payment_id) do update set
         status = case when ${rank("excluded.status")} > ${rank("billing_payments.status")} then excluded.status else billing_payments.status end,
         method = coalesce(excluded.method, billing_payments.method),
         error_code = case when excluded.status = 'failed' then excluded.error_code else billing_payments.error_code end,
         error_description = case when excluded.status = 'failed' then excluded.error_description else billing_payments.error_description end,
         captured_at = coalesce(billing_payments.captured_at, excluded.captured_at),
         updated_at = now()
       returning ${PAY_COLS}`,
      [p.shopId, p.razorpayPaymentId, p.kind, p.orderId, p.subscriptionId, p.amountPaise, p.currency, p.status, p.method,
        p.errorCode, p.errorDescription?.slice(0, 300) ?? null, p.description],
    );
    return normPay(rows[0]!);
  }

  async setPaymentGrant(paymentId: string, credits: number, grantId: string) {
    await this.db.query(
      `update public.billing_payments set credits_granted = $2, grant_id = $3, updated_at = now() where id = $1 and grant_id is null`,
      [paymentId, credits, grantId],
    );
  }

  async setPaymentRefunded(paymentId: string, amountRefundedPaise: number) {
    await this.db.query(
      `update public.billing_payments set amount_refunded_paise = greatest(amount_refunded_paise, $2),
         status = case when greatest(amount_refunded_paise, $2) >= amount_paise then 'refunded' else 'partially_refunded' end,
         updated_at = now()
       where id = $1`,
      [paymentId, amountRefundedPaise],
    );
  }

  /* ------------------------------------------------------------ refunds */
  async refundByRazorpayId(id: string) {
    const rows = await this.db.query<{ id: string; status: string; creditsReversed: number }>(
      `select id, status, credits_reversed as "creditsReversed" from public.billing_refunds where razorpay_refund_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async upsertRefund(r: { shopId: string; paymentId: string; razorpayRefundId: string; amountPaise: number; status: "created" | "processed" | "failed" }) {
    await this.db.query(
      `insert into public.billing_refunds (shop_id, payment_id, razorpay_refund_id, amount_paise, status)
       values ($1, $2, $3, $4, $5)
       on conflict (razorpay_refund_id) do update set
         status = case when billing_refunds.status = 'processed' then 'processed' else excluded.status end`,
      [r.shopId, r.paymentId, r.razorpayRefundId, r.amountPaise, r.status],
    );
  }

  async creditsAlreadyReversed(paymentId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `select coalesce(sum(credits_reversed + credits_shortfall), 0)::int as n from public.billing_refunds where payment_id = $1 and status = 'processed'`,
      [paymentId],
    );
    return rows[0]?.n ?? 0;
  }

  async markRefundProcessed(razorpayRefundId: string, reversed: number, shortfall: number) {
    await this.db.query(
      `update public.billing_refunds set status = 'processed', credits_reversed = $2, credits_shortfall = $3, processed_at = coalesce(processed_at, now())
        where razorpay_refund_id = $1`,
      [razorpayRefundId, reversed, shortfall],
    );
  }

  /* ------------------------------------------------------------ credits */
  async grantCredits(g: {
    shopId: string; amount: number; source: string; expiresAt: Date | null; key: string; reason: string;
    subscriptionId?: string | null; paymentId?: string | null; periodStart?: Date | null; periodEnd?: Date | null;
  }): Promise<string | null> {
    const rows = await this.db.query<{ id: string | null }>(
      `select public.grant_credits($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id`,
      [g.shopId, g.amount, g.source, g.expiresAt, g.key, g.reason, g.subscriptionId ?? null, g.paymentId ?? null, g.periodStart ?? null, g.periodEnd ?? null],
    );
    return rows[0]?.id ?? null;
  }

  async grantByKey(key: string): Promise<{ id: string; amount: number } | null> {
    const rows = await this.db.query<{ id: string; amount: number }>(`select id, amount from public.credit_grants where idempotency_key = $1`, [key]);
    return rows[0] ?? null;
  }

  async reverseGrant(grantId: string, credits: number, key: string, reason: string): Promise<{ reversed: number; shortfall: number }> {
    const rows = await this.db.query<{ r_reversed: number; r_shortfall: number }>(
      `select r_reversed, r_shortfall from public.reverse_grant($1, $2, $3, $4)`,
      [grantId, credits, key, reason],
    );
    return { reversed: rows[0]?.r_reversed ?? 0, shortfall: rows[0]?.r_shortfall ?? 0 };
  }

  async expireAllGrants(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(`select public.expire_credit_grants() as n`);
    return rows[0]?.n ?? 0;
  }

  async balance(shopId: string): Promise<number> {
    const rows = await this.db.query<{ balance: number }>(`select balance from public.credit_balances where shop_id = $1`, [shopId]);
    return rows[0]?.balance ?? 0;
  }

  /** Usable grants (remaining > 0, not expired), soonest expiry first. */
  async activeGrants(shopId: string): Promise<CreditGrantView[]> {
    const rows = await this.db.query<CreditGrantView>(
      `select id, source, amount, remaining, expires_at as "expiresAt", created_at as "createdAt" from public.credit_grants
        where shop_id = $1 and remaining > 0 and (expires_at is null or expires_at > now())
        order by expires_at nulls last, created_at`,
      [shopId],
    );
    return rows.map((r) => ({ ...r, expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt)! }));
  }

  async trialGrant(shopId: string) {
    const rows = await this.db.query<{ expiresAt: string | null }>(
      `select expires_at as "expiresAt" from public.credit_grants where shop_id = $1 and source = 'trial'`,
      [shopId],
    );
    return rows[0] ? { expiresAt: iso(rows[0].expiresAt) } : null;
  }

  async ledger(shopId: string, limit = 50): Promise<LedgerEntryView[]> {
    const rows = await this.db.query<LedgerEntryView & { id: string | number }>(
      `select id::text as id, entry_type::text as type, amount, balance_after as "balanceAfter", reason, created_at as "createdAt"
         from public.credit_ledger where shop_id = $1 order by id desc limit $2`,
      [shopId, limit],
    );
    return rows.map((r) => ({ ...r, id: String(r.id), createdAt: iso(r.createdAt)! }));
  }

  /* ---------------------------------------------------- webhook inbox */
  /** Stores the event (or bumps its attempt count). Returns whether it was already processed. */
  async recordWebhookEvent(e: { eventId: string; type: string; mode: BillingMode; payload: string; createdAt: Date | null }) {
    const rows = await this.db.query<{ processedAt: unknown; attempts: number }>(
      `insert into public.billing_webhook_events (event_id, event_type, mode, payload, event_created_at)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (event_id) do update set attempts = billing_webhook_events.attempts + 1
       returning processed_at as "processedAt", attempts`,
      [e.eventId, e.type, e.mode, e.payload, e.createdAt],
    );
    return { alreadyProcessed: rows[0]?.processedAt != null, attempts: rows[0]?.attempts ?? 1 };
  }

  /** Row lock so two concurrent deliveries of the same event can't both process it. */
  async lockWebhookEvent(eventId: string): Promise<{ processed: boolean }> {
    const rows = await this.db.query<{ processedAt: unknown }>(
      `select processed_at as "processedAt" from public.billing_webhook_events where event_id = $1 for update`,
      [eventId],
    );
    return { processed: rows[0]?.processedAt != null };
  }

  async markWebhookProcessed(eventId: string, outcome: string) {
    await this.db.query(
      `update public.billing_webhook_events set processed_at = now(), outcome = $2, last_error = null where event_id = $1`,
      [eventId, outcome.slice(0, 200)],
    );
  }

  async markWebhookFailed(eventId: string, error: string) {
    await this.db.query(`update public.billing_webhook_events set last_error = $2 where event_id = $1`, [eventId, error.slice(0, 500)]);
  }

  /* ----------------------------------------------------------- receipts */
  async receiptForPayment(paymentId: string) {
    const rows = await this.db.query<{ receiptNumber: string; issuedAt: unknown; buyer: unknown }>(
      `select receipt_number as "receiptNumber", issued_at as "issuedAt", buyer from public.billing_receipts where payment_id = $1`,
      [paymentId],
    );
    const r = rows[0];
    if (!r) return null;
    return { receiptNumber: r.receiptNumber, issuedAt: iso(r.issuedAt)!, buyer: (typeof r.buyer === "string" ? JSON.parse(r.buyer) : r.buyer) as Record<string, string> };
  }

  /** Issues a receipt number once per payment (numbers are gap-free per series within a transaction). */
  async issueReceipt(shopId: string, paymentId: string, series: string, buyer: Record<string, string>) {
    return this.withTx(async (tx) => {
      const existing = await tx.receiptForPayment(paymentId);
      if (existing) return existing;
      await tx.db.query(`select 1 from public.billing_payments where id = $1 for update`, [paymentId]);
      const again = await tx.receiptForPayment(paymentId);
      if (again) return again;
      await tx.db.query(
        `insert into public.billing_receipts (shop_id, payment_id, receipt_number, buyer) values ($1, $2, public.next_receipt_number($3), $4::jsonb)`,
        [shopId, paymentId, series, JSON.stringify(buyer)],
      );
      return (await tx.receiptForPayment(paymentId))!;
    });
  }

  /* -------------------------------------------------------- entitlement */
  async countCatalogues(shopId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(`select count(*)::int as n from public.catalogues where shop_id = $1 and deleted_at is null`, [shopId]);
    return rows[0]?.n ?? 0;
  }
}

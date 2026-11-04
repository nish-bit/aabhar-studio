import type { AdminMetrics } from "@/lib/admin-types";

import type { AdminDeps } from "./deps-types";
import type { AdminContext } from "./guard";

/**
 * Aggregate numbers only — no per-customer data. Test-mode and live-mode
 * revenue are always reported separately so test payments never inflate
 * real revenue.
 */
export async function getMetrics(deps: AdminDeps, _ctx: AdminContext): Promise<AdminMetrics> {
  const db = deps.db;
  const payModeExpr = `coalesce(o.mode, bs.mode)`;
  const payFrom = `from public.billing_payments p left join public.billing_orders o on o.id = p.order_id left join public.billing_subscriptions bs on bs.id = p.subscription_id`;
  const paid = `p.status in ('captured', 'refunded', 'partially_refunded')`;

  const [users, revenue, monthly, mrr, subs, jobs, daily, credits] = await Promise.all([
    db.query<AdminMetrics["users"]>(
      `select count(*)::int as total,
              count(*) filter (where created_at > now() - interval '7 days')::int as "new7d",
              count(*) filter (where created_at > now() - interval '30 days')::int as "new30d",
              count(*) filter (where disabled_at is not null)::int as disabled,
              (select count(distinct shop_id)::int from public.generation_jobs where created_at > now() - interval '30 days') as "activeShops30d"
         from public.profiles`,
    ),
    db.query<{ mode: "test" | "live"; gross30d: number; refunded30d: number; grossAll: number }>(
      `select ${payModeExpr} as mode,
              coalesce(sum(p.amount_paise) filter (where p.created_at > now() - interval '30 days'), 0)::float8 as "gross30d",
              coalesce(sum(p.amount_refunded_paise) filter (where p.created_at > now() - interval '30 days'), 0)::float8 as "refunded30d",
              coalesce(sum(p.amount_paise), 0)::float8 as "grossAll"
         ${payFrom} where ${paid} and ${payModeExpr} is not null group by 1`,
    ),
    db.query<{ mode: "test" | "live"; month: string; gross: number; refunded: number }>(
      `select ${payModeExpr} as mode, to_char(date_trunc('month', p.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
              coalesce(sum(p.amount_paise), 0)::float8 as gross, coalesce(sum(p.amount_refunded_paise), 0)::float8 as refunded
         ${payFrom} where ${paid} and p.created_at > now() - interval '6 months' and ${payModeExpr} is not null group by 1, 2 order by 2`,
    ),
    db.query<{ mode: "test" | "live"; mrr: number }>(
      `select b.mode, coalesce(sum(pp.amount_paise), 0)::float8 as mrr
         from public.billing_subscriptions b join public.plan_prices pp on pp.id = b.price_id
        where b.status in ('active', 'authenticated', 'pending') group by 1`,
    ),
    db.query<AdminMetrics["subscriptions"][number]>(
      `select plan_id as "planId", mode,
              count(*) filter (where status in ('active', 'authenticated'))::int as active,
              count(*) filter (where status in ('pending', 'halted'))::int as "pastDue"
         from public.billing_subscriptions where status in ('active', 'authenticated', 'pending', 'halted') group by 1, 2 order by 1, 2`,
    ),
    db.query<{ total: number; succeeded: number; failed: number; cost: number }>(
      `select count(*)::int as total, count(*) filter (where status = 'succeeded')::int as succeeded,
              count(*) filter (where status = 'failed')::int as failed, coalesce(sum(cost_usd_micros), 0)::float8 as cost
         from public.generation_jobs where created_at > now() - interval '30 days'`,
    ),
    db.query<{ day: string; succeeded: number; failed: number; cost: number }>(
      `select to_char(d, 'YYYY-MM-DD') as day,
              count(j.id) filter (where j.status = 'succeeded')::int as succeeded,
              count(j.id) filter (where j.status = 'failed')::int as failed,
              coalesce(sum(j.cost_usd_micros), 0)::float8 as cost
         from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
         left join public.generation_jobs j on (j.created_at at time zone 'Asia/Kolkata')::date = d::date
        group by d order by d`,
    ),
    db.query<{ type: string; total: number }>(
      `select entry_type::text as type, coalesce(sum(amount), 0)::int as total
         from public.credit_ledger where created_at > now() - interval '30 days' group by 1 order by 1`,
    ),
  ]);

  const modes = new Set<"test" | "live">([...revenue.map((r) => r.mode), ...mrr.map((r) => r.mode)]);
  return {
    generatedAt: new Date().toISOString(),
    users: users[0] ?? { total: 0, new7d: 0, new30d: 0, disabled: 0, activeShops30d: 0 },
    revenue: [...modes].sort().map((mode) => {
      const r = revenue.find((x) => x.mode === mode);
      return {
        mode,
        gross30dPaise: Number(r?.gross30d ?? 0),
        refunded30dPaise: Number(r?.refunded30d ?? 0),
        grossAllTimePaise: Number(r?.grossAll ?? 0),
        mrrPaise: Number(mrr.find((x) => x.mode === mode)?.mrr ?? 0),
        monthly: monthly.filter((m) => m.mode === mode).map((m) => ({ month: m.month, grossPaise: Number(m.gross), refundedPaise: Number(m.refunded) })),
      };
    }),
    subscriptions: subs,
    jobs: {
      total30d: jobs[0]?.total ?? 0,
      succeeded30d: jobs[0]?.succeeded ?? 0,
      failed30d: jobs[0]?.failed ?? 0,
      costUsdMicros30d: Number(jobs[0]?.cost ?? 0),
      daily: daily.map((d) => ({ day: d.day, succeeded: d.succeeded, failed: d.failed, costUsdMicros: Number(d.cost) })),
    },
    credits30d: credits,
  };
}

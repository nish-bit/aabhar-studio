import { planById, type PlanConfig, type PlanLimits } from "@/config/billing";
import type { Db } from "@/server/db/sql";

/**
 * Plan limits and monthly credits that an admin changed in the dashboard.
 * When a plan has an override, it wins over src/config/billing.ts. Prices
 * are never overridden here (they live in Razorpay Plans).
 */
export type PlanOverrides = Map<string, { monthlyCredits: number; limits: PlanLimits }>;

export async function loadPlanOverrides(db: Db): Promise<PlanOverrides> {
  const rows = await db.query<{ id: string; monthlyCredits: number; limits: unknown }>(
    `select id, monthly_credits as "monthlyCredits", limits from public.plans where overridden_at is not null`,
  );
  return new Map(
    rows.map((r) => [r.id, { monthlyCredits: r.monthlyCredits, limits: (typeof r.limits === "string" ? JSON.parse(r.limits) : r.limits) as PlanLimits }]),
  );
}

export function effectivePlan(id: string, overrides?: PlanOverrides): PlanConfig | undefined {
  const base = planById(id);
  if (!base) return undefined;
  const o = overrides?.get(id);
  return o ? { ...base, monthlyCredits: o.monthlyCredits, limits: o.limits } : base;
}

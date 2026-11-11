import { z } from "zod";

import { planById, type PlanConfig, type PlanLimits } from "@/config/billing";
import { CATALOGUE_LIMITS } from "@/lib/catalogue";
import { PRESET_SLUGS } from "@/lib/presets";
import type { Db } from "@/server/db/sql";

/**
 * Plan limits and monthly credits that an admin changed in the dashboard.
 * When a plan has an override, it wins over src/config/billing.ts. Prices
 * are never overridden here (they live in Razorpay Plans and the pack config).
 */
export type PlanOverrides = Map<string, { monthlyCredits: number; limits: PlanLimits }>;

/** What an admin may set (src/server/admin/configuration.ts validates writes with these). */
export const planLimitsSchema = z.object({
  maxActiveJobs: z.number().int().min(1).max(20),
  dailyGenerations: z.number().int().min(1).max(10_000),
  maxCatalogues: z.number().int().min(0).max(1000),
  maxCatalogueItems: z.number().int().min(1).max(CATALOGUE_LIMITS.maxItems),
  presets: z.union([z.literal("all"), z.array(z.enum(PRESET_SLUGS)).min(1).max(PRESET_SLUGS.length)]),
});
export const planMonthlyCreditsSchema = z.number().int().min(0).max(100_000);
export const trialTermsSchema = z.object({
  credits: z.number().int().min(0).max(1000),
  validityDays: z.number().int().min(1).max(3650),
});

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

/**
 * Keeps only overrides that are for a plan in src/config/billing.ts and within
 * the limits an admin could have set. Anything else is dropped (that plan keeps
 * its config values) and reported, never trusted.
 */
export function validPlanOverrides(
  rows: { id: string; monthlyCredits: unknown; limits: unknown }[],
  onInvalid: (planId: string, reason: string) => void,
): PlanOverrides {
  const valid: PlanOverrides = new Map();
  for (const r of rows) {
    if (!planById(r.id)) {
      onInvalid(r.id, "unknown plan id");
      continue;
    }
    let limits: unknown = r.limits;
    if (typeof limits === "string") {
      try {
        limits = JSON.parse(limits);
      } catch {
        onInvalid(r.id, "limits is not JSON");
        continue;
      }
    }
    const credits = planMonthlyCreditsSchema.safeParse(r.monthlyCredits);
    const parsedLimits = planLimitsSchema.safeParse(limits);
    if (!credits.success || !parsedLimits.success) {
      onInvalid(r.id, !credits.success ? "monthly credits out of range" : "limits out of range");
      continue;
    }
    valid.set(r.id, { monthlyCredits: credits.data, limits: parsedLimits.data as PlanLimits });
  }
  return valid;
}

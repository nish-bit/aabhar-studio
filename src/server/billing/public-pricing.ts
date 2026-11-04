import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { billingConfig, type PlanConfig } from "@/config/billing";
import { buildComparison, buildPricing, type TrialTerms } from "@/config/plans";
import { database } from "@/server/db/postgres";

import { effectivePlan, loadPlanOverrides } from "./plan-overrides";

/** Kept in sync with PLANS_CACHE_TAG in src/server/admin/deps.ts. */
const TAG = "billing-plans";

/**
 * Public pricing with any admin plan/trial changes applied. Cached and
 * refreshed when an admin saves a change; falls back to the config file
 * when the database isn't reachable.
 */
export async function getPublicPricing() {
  "use cache";
  cacheTag(TAG);
  cacheLife("hours");

  let plans: PlanConfig[] = billingConfig.plans;
  let trial: TrialTerms = { credits: billingConfig.trial.credits, validityDays: billingConfig.trial.validityDays };
  const db = database();
  if (db) {
    try {
      const [overrides, settings] = await Promise.all([
        loadPlanOverrides(db),
        db.query<TrialTerms>(`select trial_credits as credits, trial_validity_days as "validityDays" from public.billing_settings where id`),
      ]);
      plans = billingConfig.plans.map((p) => effectivePlan(p.id, overrides)!);
      if (settings[0]) trial = settings[0];
    } catch (err) {
      console.error(JSON.stringify({ event: "pricing.overrides_unavailable", error: String(err) }));
    }
  }
  return { pricing: buildPricing(plans, trial), comparison: buildComparison(plans, trial) };
}

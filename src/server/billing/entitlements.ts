import { billingConfig, type PlanId, type PlanLimits } from "@/config/billing";
import type { EntitlementView } from "@/lib/billing-types";

import { effectivePlan, loadPlanOverrides, type PlanOverrides } from "./plan-overrides";
import type { BillingRepository, SubscriptionRow } from "./repository";

/**
 * What a shop may do right now, decided only from server-side records
 * (subscription rows written by verified webhooks / API fetches).
 *
 * - active / authenticated           → the plan's limits
 * - pending (Razorpay retrying)      → still the plan's limits, flagged past due
 * - halted / paused                  → lapsed limits until payment resumes
 * - cancelled / completed / expired  → the plan's limits until the paid period ends, then lapsed
 * - never subscribed                 → trial limits
 * - bought a credit pack              → pack limits (all styles), unless a live plan gives more
 *
 * Credits are separate: whatever unexpired credits a shop has stay usable.
 */
export function computeEntitlement(
  sub: SubscriptionRow | null,
  now: Date = new Date(),
  overrides?: PlanOverrides,
  hasPack = false,
): EntitlementView {
  const base = subscriptionEntitlement(sub, now, overrides);
  // Pack buyers never get less than the pack limits (trial, lapsed or halted plans would).
  if (hasPack && (base.state === "trial" || base.limits === billingConfig.lapsedLimits)) {
    return { planId: "trial", planName: "Credit packs", state: "pack", limits: billingConfig.packLimits };
  }
  return base;
}

function subscriptionEntitlement(sub: SubscriptionRow | null, now: Date, overrides?: PlanOverrides): EntitlementView {
  const trial = effectivePlan("trial", overrides)!;
  if (!sub) return { planId: "trial", planName: trial.name, state: "trial", limits: trial.limits };

  const plan = effectivePlan(sub.planId, overrides);
  const planId = (plan?.id ?? "trial") as PlanId;
  const planName = plan?.name ?? sub.planId;
  const planLimits: PlanLimits = plan?.limits ?? billingConfig.lapsedLimits;
  const periodOpen = sub.currentEnd !== null && new Date(sub.currentEnd) > now;

  switch (sub.status) {
    case "active":
    case "authenticated":
      return { planId, planName, state: "subscribed", limits: planLimits };
    case "pending":
      return { planId, planName, state: "past_due", limits: planLimits };
    case "halted":
    case "paused":
      return { planId, planName, state: "past_due", limits: billingConfig.lapsedLimits };
    case "cancelled":
    case "completed":
    case "expired":
      return periodOpen
        ? { planId, planName, state: "grace", limits: planLimits }
        : { planId, planName, state: "lapsed", limits: billingConfig.lapsedLimits };
    default:
      return { planId, planName, state: "lapsed", limits: billingConfig.lapsedLimits };
  }
}

export async function loadEntitlement(repo: BillingRepository, shopId: string, now = new Date()): Promise<EntitlementView> {
  const [sub, overrides, hasPack] = await Promise.all([repo.currentSubscription(shopId), loadPlanOverrides(repo.db), repo.hasPackPurchase(shopId)]);
  return computeEntitlement(sub, now, overrides, hasPack);
}

/** Limits lookup used by the generation and catalogue services. */
export type EntitlementsLookup = (shopId: string) => Promise<PlanLimits>;

export function entitlementsLookup(repo: BillingRepository): EntitlementsLookup {
  return async (shopId) => (await loadEntitlement(repo, shopId)).limits;
}

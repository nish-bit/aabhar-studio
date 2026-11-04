/**
 * Billing configuration — the single source of truth for plans, prices,
 * credits, limits and credit packs.
 *
 * Change prices or limits HERE, then run `npm run billing:sync` to copy them
 * into the database (and, for paid plans, create the matching Razorpay Plan
 * in the current mode). Razorpay Plans can't be edited once created, so a new
 * price creates a new Razorpay Plan; existing subscribers stay on their old
 * price until they change plan.
 *
 * STATUS: prices below are placeholders awaiting your approval. The pricing
 * page shows "Indicative pricing" while `pricesApproved` is false.
 */

export type PlanId = "trial" | "starter" | "growth" | "premium";
export type PaidPlanId = Exclude<PlanId, "trial">;
export type PresetAccess = "all" | readonly string[];

export interface PlanLimits {
  /** Generations a shop may have queued or running at once. */
  maxActiveJobs: number;
  /** Generations a shop may start per rolling 24 hours. */
  dailyGenerations: number;
  /** Catalogues a shop may keep (not counting deleted ones). */
  maxCatalogues: number;
  /** Products per catalogue. */
  maxCatalogueItems: number;
  /** Which editing styles the plan can use. */
  presets: PresetAccess;
}

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  /** Credits granted each billing month (trial: once, at sign-up). */
  monthlyCredits: number;
  /** Monthly price in paise, as charged (see `gst.pricesIncludeGst`). null = free. */
  monthlyPricePaise: number | null;
  limits: PlanLimits;
  recommended?: boolean;
}

export interface CreditPackConfig {
  id: string;
  name: string;
  credits: number;
  pricePaise: number;
  /** Pack credits expire this many days after purchase. */
  validityDays: number;
  /** Only sold to shops that have never paid for a pack (checked on the server). */
  firstPurchaseOnly?: boolean;
  /** A first purchase of this pack earns referral rewards. */
  referralQualifying?: boolean;
}

export const BASIC_PRESETS = ["white-studio", "warm-ivory", "black-luxury"] as const;

/** Configurable trial allowance: credits granted once at sign-up, and how long they last. */
const TRIAL = { credits: 2, validityDays: 30 } as const;

/**
 * Free generations every new account gets (one trial credit each: trial
 * accounts can only use the 1-credit styles). Enforced on the server by the
 * credit ledger, not by the browser.
 */
export const FREE_TRIAL_LIMIT = TRIAL.credits;

export const billingConfig = {
  currency: "INR" as const,
  /** Flip to true once you approve these prices; removes the "indicative" label. */
  pricesApproved: false,

  trial: TRIAL,

  /** Plan credits are valid for the billing period they were granted for. */
  planCreditPolicy: "expire_at_period_end" as const,

  /**
   * Number of monthly cycles a subscription is created for (Razorpay requires
   * a finite total_count). 120 = 10 years; customers cancel any time.
   */
  subscriptionTotalCount: 120,

  /**
   * Receipt numbering: "<prefix>/<financial year>/<000001>". Receipts are
   * payment receipts, not GST tax invoices, until the seller details below
   * are filled in and approved.
   */
  receipts: {
    prefix: "AS",
    /** Your registered business details. Left empty until you supply them; receipts say so. */
    seller: { legalName: "", address: "", gstin: "", email: "" },
  },

  gst: {
    /** Whether the plan and pack prices above already include GST. Confirm with your accountant. */
    pricesIncludeGst: true,
    ratePercent: 18,
  },

  plans: [
    {
      id: "trial",
      name: "Free trial",
      tagline: "See your own pieces transformed",
      monthlyCredits: TRIAL.credits,
      monthlyPricePaise: null,
      limits: { maxActiveJobs: 1, dailyGenerations: 20, maxCatalogues: 1, maxCatalogueItems: 12, presets: BASIC_PRESETS },
    },
    {
      id: "starter",
      name: "Starter",
      tagline: "For a single shop's weekly photos",
      monthlyCredits: 100,
      monthlyPricePaise: 99_900,
      limits: { maxActiveJobs: 2, dailyGenerations: 100, maxCatalogues: 5, maxCatalogueItems: 40, presets: BASIC_PRESETS },
    },
    {
      id: "growth",
      name: "Growth",
      tagline: "For growing shops and brands",
      monthlyCredits: 300,
      monthlyPricePaise: 249_900,
      limits: { maxActiveJobs: 3, dailyGenerations: 300, maxCatalogues: 25, maxCatalogueItems: 100, presets: "all" },
      recommended: true,
    },
    {
      id: "premium",
      name: "Premium",
      tagline: "For wholesalers and multi-store teams",
      monthlyCredits: 1000,
      monthlyPricePaise: 699_900,
      limits: { maxActiveJobs: 5, dailyGenerations: 1000, maxCatalogues: 200, maxCatalogueItems: 100, presets: "all" },
    },
  ] as PlanConfig[],

  /**
   * One-time credit packs (approved 3 Nov 2026; replaced the 50/200/500 packs).
   * `npm run billing:sync -- --apply` adds these to credit_packs and
   * deactivates the old ones, so earlier orders keep their records.
   */
  packs: [
    { id: "starter-pack", name: "Starter Pack", credits: 3, pricePaise: 24_900, validityDays: 365, firstPurchaseOnly: true },
    { id: "solo", name: "Solo", credits: 20, pricePaise: 149_900, validityDays: 365, referralQualifying: true },
    { id: "signature", name: "Signature", credits: 75, pricePaise: 399_900, validityDays: 365, referralQualifying: true },
    { id: "studio", name: "Studio", credits: 500, pricePaise: 1_999_900, validityDays: 365, referralQualifying: true },
  ] as CreditPackConfig[],

  /**
   * Referral rewards, given once when an invited jeweller's first
   * referral-qualifying pack payment is captured (Solo or larger). Reversed
   * if that payment is fully refunded.
   */
  referral: { referrerCredits: 10, refereeCredits: 2, validityDays: 365 },

  /**
   * Limits for any shop that has bought a credit pack (approved 3 Nov 2026,
   * when the monthly plans were taken off sale): all six styles and the
   * former Growth plan's limits. Free-trial shops keep the trial limits.
   */
  packLimits: { maxActiveJobs: 3, dailyGenerations: 300, maxCatalogues: 25, maxCatalogueItems: 100, presets: "all" } as PlanLimits,

  /**
   * Limits when a subscription has lapsed (halted, or cancelled and past its
   * period end) and the trial is over: existing credits stay usable.
   */
  lapsedLimits: { maxActiveJobs: 1, dailyGenerations: 50, maxCatalogues: 1, maxCatalogueItems: 12, presets: BASIC_PRESETS } as PlanLimits,
} as const;

export function planById(id: string): PlanConfig | undefined {
  return billingConfig.plans.find((p) => p.id === id);
}

export function packById(id: string): CreditPackConfig | undefined {
  return billingConfig.packs.find((p) => p.id === id);
}

export function paidPlans(): (PlanConfig & { id: PaidPlanId; monthlyPricePaise: number })[] {
  return billingConfig.plans.filter((p): p is PlanConfig & { id: PaidPlanId; monthlyPricePaise: number } => p.monthlyPricePaise !== null);
}

export function presetAllowed(access: PresetAccess, slug: string): boolean {
  return access === "all" || access.includes(slug);
}

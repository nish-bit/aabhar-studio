import type { ComparisonRow, PackOffer } from "@/components/marketing/pricing-page";
import { billingConfig, type PlanConfig, type PlanLimits } from "@/config/billing";
import { formatCount } from "@/lib/format";
import type { FaqItem, PricingConfig } from "@/types/content";

/**
 * Marketing view of the plans, used by the homepage teaser and the pricing
 * page. Built from src/config/billing.ts, or from the effective plans (with
 * admin overrides) via src/server/billing/public-pricing.ts. Monthly only.
 */
const presetLabel = (access: PlanLimits["presets"]) => (access === "all" ? "All 6" : `${access.length} essential`);

export interface TrialTerms {
  credits: number;
  validityDays: number;
}

/** The one sign-up message, used wherever the free allowance is mentioned. */
export const freeImagesMessage = (credits: number) => `Get ${credits} free AI jewellery ${credits === 1 ? "image" : "images"} when you sign up.`;

const defaultTrial: TrialTerms = { credits: billingConfig.trial.credits, validityDays: billingConfig.trial.validityDays };

/** Highlights are generated from the numbers, so they can't drift from the real limits. */
function highlightsFor(p: PlanConfig, trial: TrialTerms): string[] {
  const images = p.monthlyPricePaise === null ? `${trial.credits} images, once` : `${formatCount(p.monthlyCredits)} images a month`;
  const styles = p.limits.presets === "all" ? "All six styles" : `${p.limits.presets.length} essential styles`;
  const catalogues = `${formatCount(p.limits.maxCatalogues)} ${p.limits.maxCatalogues === 1 ? "catalogue" : "catalogues"} up to ${p.limits.maxCatalogueItems} products`;
  return [images, styles, catalogues];
}

export function buildPricing(plans: PlanConfig[], trial: TrialTerms = defaultTrial): PricingConfig {
  return {
    currency: "INR",
    gstRatePercent: billingConfig.gst.ratePercent,
    gstIncluded: billingConfig.gst.pricesIncludeGst,
    trialCredits: trial.credits,
    status: billingConfig.pricesApproved ? "final" : "indicative",
    annualDiscountLabel: "",
    plans: plans.map((p) => {
      const credits = p.monthlyPricePaise === null ? trial.credits : p.monthlyCredits;
      return {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        pricePaise: { monthly: p.monthlyPricePaise, yearly: null },
        creditsPerMonth: p.monthlyPricePaise === null ? 0 : credits,
        oneTimeCredits: p.monthlyPricePaise === null ? credits : undefined,
        limits: [
          { label: "Images", value: p.monthlyPricePaise === null ? `${credits}, once` : `${formatCount(credits)} a month` },
          { label: "Running at once", value: String(p.limits.maxActiveJobs) },
          { label: "Catalogues", value: `${p.limits.maxCatalogues} × up to ${p.limits.maxCatalogueItems} products` },
        ],
        highlights: highlightsFor(p, trial),
        cta: p.monthlyPricePaise === null ? { label: "Start free", href: "/login" } : { label: `Choose ${p.name}`, href: `/app/billing?plan=${p.id}` },
        recommended: p.recommended,
      };
    }),
  };
}

/** Rows for the plan comparison table on /pricing, in the same order as the plans. */
export function buildComparison(plans: PlanConfig[], trial: TrialTerms = defaultTrial): ComparisonRow[] {
  return [
    { label: "Images", values: plans.map((p) => (p.monthlyPricePaise === null ? `${trial.credits}, once` : `${formatCount(p.monthlyCredits)} / month`)) },
    { label: "Editing styles", values: plans.map((p) => presetLabel(p.limits.presets)) },
    { label: "Generations running at once", values: plans.map((p) => String(p.limits.maxActiveJobs)) },
    { label: "Generations per day", values: plans.map((p) => formatCount(p.limits.dailyGenerations)) },
    { label: "Catalogues", values: plans.map((p) => formatCount(p.limits.maxCatalogues)) },
    { label: "Products per catalogue", values: plans.map((p) => String(p.limits.maxCatalogueItems)) },
    { label: "Print-ready PDF and image ZIP", values: plans.map(() => true) },
    { label: "Credit packs available", values: plans.map(() => true) },
    { label: "Credits valid for", values: plans.map((p) => (p.monthlyPricePaise === null ? `${trial.validityDays} days` : "The billing month")) },
  ];
}

/** Config-only defaults (used where the database isn't needed, e.g. the footer's GST note). */
export const pricing: PricingConfig = buildPricing(billingConfig.plans);
export const pricingComparison: ComparisonRow[] = buildComparison(billingConfig.plans);

/**
 * What every pack includes. Only claims the product meets: outputs are at
 * most 1536 px, and generation takes a short while (not "instant").
 */
const PACK_FEATURES = [
  "All six styles, including Velvet, Marble and Editorial",
  "Fast AI generation, no photoshoot needed",
  "High-resolution downloads (up to 1536 px)",
  "Commercial usage rights",
];

/** Card extras by pack id. A pack missing here still renders, just without a badge. */
const PACK_EXTRAS: Record<string, { badge?: string; featured?: boolean; features?: string[] }> = {
  "starter-pack": { badge: "First purchase only" },
  signature: { badge: "Most popular", featured: true },
  studio: { badge: "For brands & wholesalers", features: ["Priority email support"] },
};

export const pricingPacks: PackOffer[] = billingConfig.packs.map((p) => ({
  ...p,
  perCreditPaise: Math.round(p.pricePaise / p.credits),
  badge: PACK_EXTRAS[p.id]?.badge,
  featured: PACK_EXTRAS[p.id]?.featured ?? false,
  features: [...PACK_FEATURES, ...(PACK_EXTRAS[p.id]?.features ?? [])],
}));

export const billingFaqs: FaqItem[] = [
  {
    question: "What happens to unused credits?",
    answer:
      "Credits from a pack last 12 months from purchase. Free trial credits expire sooner; your billing page shows every expiry date. We always spend the credits that expire soonest first.",
  },
  {
    question: "What if an image fails?",
    answer: "Its credits go straight back to your balance. If they came from credits that have since expired, you get them back for 30 more days.",
  },
  {
    question: "Is this a subscription?",
    answer: "No. Every plan is a one-time payment through Razorpay. Nothing renews, and you only buy more credits when you need them.",
  },
  {
    question: "Can I get a refund?",
    answer:
      "Contact us. If we refund a payment, the credits it bought are removed from your balance; credits you've already used can't be removed.",
  },
];

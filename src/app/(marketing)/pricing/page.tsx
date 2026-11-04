import type { Metadata } from "next";

import { PricingPageView } from "@/components/marketing/pricing-page";
import { billingFaqs, pricingPacks } from "@/config/plans";
import { getPublicPricing } from "@/server/billing/public-pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One-time credit plans for AI jewellery photography and catalogues. No subscription; start with free images.",
};

export default async function PricingPage() {
  const { pricing } = await getPublicPricing();
  return <PricingPageView pricing={pricing} packs={pricingPacks} faqs={billingFaqs} />;
}

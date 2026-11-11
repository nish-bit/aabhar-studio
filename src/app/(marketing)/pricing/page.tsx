import type { Metadata } from "next";

import { PricingPageView } from "@/components/marketing/pricing-page";
import { billingFaqs, pricingPacks } from "@/config/plans";
import { JsonLd } from "@/components/seo/json-ld";
import { pageMetadata } from "@/lib/site";
import { breadcrumbSchema, faqSchema, graph } from "@/lib/structured-data";
import { getPublicPricing } from "@/server/billing/public-pricing";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  socialTitle: "Aabhar Studio Pricing — Credit Plans for AI Jewellery Photos",
  description: "One-time credit plans for AI jewellery photography and catalogues. No subscription; start with free images.",
  path: "/pricing",
});

export default async function PricingPage() {
  const { pricing } = await getPublicPricing();
  return (
    <>
      <JsonLd data={graph(breadcrumbSchema("Pricing", "/pricing"), faqSchema(billingFaqs))} />
      <PricingPageView pricing={pricing} packs={pricingPacks} faqs={billingFaqs} />
    </>
  );
}

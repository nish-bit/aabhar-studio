import { billingConfig } from "@/config/billing";
import { brand, productSummary } from "@/content/marketing";
import type { FaqItem } from "@/types/content";

import { absoluteUrl, OG_IMAGE, SITE_NAME, SITE_URL } from "./site";

/**
 * schema.org JSON-LD for the public pages. Only facts the site already
 * states: no ratings, reviews or customer counts. Paid prices are left out
 * until billingConfig.pricesApproved is true (the pricing page labels them
 * "indicative" until then).
 */

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: brand.tagline,
    logo: absoluteUrl("/brand/google-oauth-logo-120.png"),
    email: brand.supportEmail,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: brand.supportEmail,
      ...(brand.supportWhatsApp ? { telephone: `+${brand.supportWhatsApp}` } : {}),
      areaServed: "IN",
    },
  };
}

export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: productSummary.answer,
    inLanguage: "en-IN",
    publisher: { "@id": ORG_ID },
  };
}

export function softwareApplicationSchema({ trialCredits }: { trialCredits: number }) {
  const offers: Record<string, unknown>[] = [
    {
      "@type": "Offer",
      name: "Free trial",
      price: "0",
      priceCurrency: "INR",
      description: `${trialCredits} free AI jewellery ${trialCredits === 1 ? "image" : "images"} on sign-up`,
      url: absoluteUrl("/pricing"),
    },
  ];
  if (billingConfig.pricesApproved) {
    for (const p of billingConfig.packs) {
      offers.push({
        "@type": "Offer",
        name: p.name,
        price: (p.pricePaise / 100).toFixed(2),
        priceCurrency: "INR",
        description: `${p.credits} credits, one-time payment`,
        url: absoluteUrl("/pricing"),
      });
    }
  }
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    applicationCategory: "DesignApplication",
    operatingSystem: "Web browser",
    inLanguage: "en-IN",
    image: absoluteUrl(OG_IMAGE.url),
    // The same wording as the visible "What is Aabhar Studio?" section, so the markup can't drift from the page.
    description: productSummary.answer,
    featureList: productSummary.features,
    publisher: { "@id": ORG_ID },
    offers,
  };
}

export function faqSchema(items: FaqItem[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
}

/** Home › page. Every public page sits one level below the homepage. */
export function breadcrumbSchema(name: string, path: string) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name, item: absoluteUrl(path) },
    ],
  };
}

export const graph = (...nodes: object[]) => ({ "@context": "https://schema.org", "@graph": nodes });

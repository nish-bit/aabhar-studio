import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { billingConfig } from "@/config/billing";
import { billingFaqs } from "@/config/plans";
import { homeFaqs, productSummary } from "@/content/marketing";
import { absoluteUrl, PUBLIC_PAGES, SITE_URL } from "@/lib/site";
import {
  breadcrumbSchema,
  faqSchema,
  graph,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/structured-data";

/**
 * JSON-LD must only restate what the pages show: no ratings, reviews or
 * customer counts, and paid prices only once they're approved.
 */
describe("structured data", () => {
  const home = graph(organizationSchema(), websiteSchema(), softwareApplicationSchema({ trialCredits: 2 }), faqSchema(homeFaqs(2)));
  const json = JSON.stringify(home);

  it("has no ratings, reviews or invented counts", () => {
    expect(json).not.toMatch(/aggregateRating|"review"|ratingValue|reviewCount|numberOfEmployees/i);
  });

  it("describes the product in the same words as the visible summary", () => {
    const app = softwareApplicationSchema({ trialCredits: 2 });
    expect(app.description).toBe(productSummary.answer);
    expect(app.featureList).toEqual(productSummary.features);
  });

  it("lists paid offers only when prices are approved", () => {
    const offers = softwareApplicationSchema({ trialCredits: 2 }).offers;
    expect(offers[0]).toMatchObject({ price: "0", priceCurrency: "INR" });
    expect(offers).toHaveLength(billingConfig.pricesApproved ? 1 + billingConfig.packs.length : 1);
  });

  it("marks up every visible FAQ, with plain-text answers", () => {
    for (const items of [homeFaqs(2), billingFaqs]) {
      const schema = faqSchema(items);
      expect(schema.mainEntity).toHaveLength(items.length);
      for (const q of schema.mainEntity) {
        expect(q.name.length).toBeGreaterThan(0);
        expect(q.acceptedAnswer.text).not.toMatch(/<[a-z]/i);
      }
    }
    const questions = homeFaqs(2).map((f) => f.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("uses absolute URLs on the canonical host", () => {
    for (const url of json.match(/https?:\/\/[^"]+/g) ?? []) {
      if (url.startsWith("https://schema.org")) continue;
      expect(url.startsWith(SITE_URL)).toBe(true);
    }
    expect(breadcrumbSchema("Pricing", "/pricing").itemListElement[1]!.item).toBe(`${SITE_URL}/pricing`);
  });
});

describe("crawl files", () => {
  it("sitemap lists exactly the public pages, on the canonical host", () => {
    expect(sitemap().map((e) => e.url)).toEqual(PUBLIC_PAGES.map((p) => absoluteUrl(p.path)));
  });

  it("robots allows search crawlers, blocks AI training crawlers, and keeps private paths out", () => {
    const { rules } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    const groupFor = (agent: string) => list.find((r) => [r.userAgent ?? []].flat().includes(agent))!;

    for (const search of ["Googlebot", "Bingbot", "OAI-SearchBot", "PerplexityBot", "*"]) {
      const g = groupFor(search);
      expect(g.allow).toBe("/");
      expect(g.disallow).toEqual(expect.arrayContaining(["/app/", "/admin", "/api/"]));
    }
    for (const training of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended"]) {
      const g = groupFor(training);
      expect(g.disallow).toBe("/");
      expect(g.allow).toBeUndefined();
    }
    // No agent may appear in two groups (crawlers would merge them unpredictably).
    const agents = list.flatMap((r) => [r.userAgent ?? []].flat());
    expect(new Set(agents).size).toBe(agents.length);
  });
});

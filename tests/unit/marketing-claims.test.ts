import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as marketing from "@/content/marketing";
import { PRESET_SLUGS, PRESETS } from "@/lib/presets";

/**
 * Marketing copy must describe the product that exists. These checks fail
 * if the homepage drifts from the real presets or mentions features that
 * aren't built. When a feature ships, remove its phrase from UNBUILT.
 */
const UNBUILT = [
  /\bbatch\b/i, // one photo at a time today
  /\bfolder\b/i,
  /\bbulk\b/i,
  /spreadsheet|csv/i,
  /price-list layout/i,
  /private link/i,
  /\b(4:5|9:16|3:4)\b/,
  /sku from file/i,
  /brand kit/i,
  /\bflag(ged|s)?\b.*(blur|dark|duplicate|detail)/i,
  /share (it )?(to|on) whatsapp/i,
  /guarantee/i,
  /\b\d[\d,]*\+? (jewellers|customers|users)\b/i, // no unverified customer counts
];

const marketingFiles = [
  "src/content/marketing.ts",
  ...["hero", "how-it-works", "preset-showcase", "category-showcase", "catalogue-band", "segments", "faq", "final-cta", "pricing-teaser", "pricing-page", "style-gallery", "photo-gallery-section", "product-summary"].map(
    (f) => `src/components/marketing/${f}.tsx`,
  ),
];

describe("marketing claims", () => {
  it("shows exactly the real presets, with their real names and credit costs", () => {
    expect(marketing.presets.map((p) => p.slug)).toEqual([...PRESET_SLUGS]);
    for (const p of marketing.presets) {
      const real = PRESETS[p.slug as keyof typeof PRESETS];
      expect(p.name).toBe(real.name);
      expect(p.creditCost).toBe(real.creditCost);
    }
  });

  it("doesn't mention features that aren't built, or unverified numbers", () => {
    const root = path.resolve(__dirname, "../..");
    for (const f of marketingFiles) {
      const text = readFileSync(path.join(root, f), "utf8");
      for (const re of UNBUILT) expect(text, `${f} matches ${re}`).not.toMatch(re);
    }
  });

  it("doesn't put invented weights or purity in the sample catalogue", () => {
    const json = JSON.stringify(marketing.catalogueSample);
    expect(json).not.toMatch(/\d+(\.\d+)?\s?g"|\b(22|18|14)K\b/);
  });
});

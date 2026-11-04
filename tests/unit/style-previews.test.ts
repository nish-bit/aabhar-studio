import { describe, expect, it } from "vitest";

import { STYLE_CATEGORIES, STYLE_PREVIEWS } from "@/content/style-previews";

const base = "https://gehnaphoto.com/assets/style_previews";

describe("style preview gallery", () => {
  it("shows exactly the 16 agreed photos, in order", () => {
    expect(STYLE_PREVIEWS.map((p) => [p.name, p.src.replace(base, "")])).toEqual([
      ["Jewellery Set Macro", "/jewellery_set/macro/preview.jpg"],
      ["Payal Flatlay", "/payal/flatlay/preview.jpg"],
      ["Ring Studio", "/ring/studio/preview.jpg"],
      ["Payal Shop Display", "/payal/shop_display/preview.jpg"],
      ["Maan Tika Indian Bridal", "/maan_tika/indian_bridal/preview.jpg"],
      ["Bracelet Bangle Modern Wear", "/bracelet_bangle/modern_wear/preview.jpg"],
      ["Bracelet Closeup", "/bracelet/closeup/preview.jpg"],
      ["Ring Flatlay", "/ring/flatlay/preview.jpg"],
      ["Maan Tika Studio", "/maan_tika/studio/preview.jpg"],
      ["Pendant Macro", "/pendant/macro/preview.jpg"],
      ["Bracelet Macro", "/bracelet/macro/preview.jpg"],
      ["Bracelet Indian Bridal", "/bracelet/indian_bridal/preview.jpg"],
      ["Ring Shop Display", "/ring/shop_display/preview.jpg"],
      ["Ring Macro", "/ring/macro/preview.jpg"],
      ["Earring Indian Bridal", "/earring/indian_bridal/preview.jpg"],
      ["Earring Modern Wear", "/earring/modern_wear/preview.jpg"],
    ]);
    for (const p of STYLE_PREVIEWS) expect(p.src.startsWith(base + "/")).toBe(true);
  });

  it("gives every photo a unique id and real alt text", () => {
    expect(new Set(STYLE_PREVIEWS.map((p) => p.id)).size).toBe(STYLE_PREVIEWS.length);
    for (const p of STYLE_PREVIEWS) expect(p.alt.length).toBeGreaterThan(15);
  });

  it("has every filter, and every filter matches at least one photo", () => {
    expect(STYLE_CATEGORIES.map((c) => c.label)).toEqual([
      "All Styles",
      "Rings",
      "Earrings",
      "Bracelets & Bangles",
      "Payal",
      "Maan Tika",
      "Pendant",
      "Jewellery Sets",
    ]);
    for (const c of STYLE_CATEGORIES.filter((c) => c.id !== "all")) {
      expect(STYLE_PREVIEWS.some((p) => p.category === c.id), c.label).toBe(true);
    }
    const counts = Object.fromEntries(STYLE_CATEGORIES.slice(1).map((c) => [c.id, STYLE_PREVIEWS.filter((p) => p.category === c.id).length]));
    expect(counts).toEqual({ ring: 4, earring: 2, bracelet: 4, payal: 2, "maang-tikka": 2, pendant: 1, set: 1 });
  });
});

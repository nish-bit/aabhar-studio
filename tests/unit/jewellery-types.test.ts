import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GENERATOR_STEPS, isJewelleryType, JEWELLERY_TYPES } from "@/lib/jewellery-types";

const root = path.resolve(import.meta.dirname, "../..");

describe("generator step 1: jewellery types", () => {
  it("offers exactly the nine types, in order, with the agreed ids, names and descriptions", () => {
    expect(JEWELLERY_TYPES.map((t) => [t.id, t.name, t.description])).toEqual([
      ["jewellery_set", "Jewellery Set", "Necklace & Tops together"],
      ["bracelet", "Bracelet", "Wrist jewellery"],
      ["earring", "Earring", "Single or Pair"],
      ["ring", "Ring", "Finger jewellery"],
      ["bangles", "Bangles", "Stack or Single"],
      ["necklace", "Necklace", "Solo necklace"],
      ["pendant", "Pendant", "Neckpiece Charm"],
      ["payal", "Payal", "Ankle jewellery"],
      ["maang_teeka", "Maang Teeka", "Forehead jewellery"],
    ]);
  });

  it("serves every card image from this project (no external hotlinks), with alt text", () => {
    for (const t of JEWELLERY_TYPES) {
      expect(t.image.src.startsWith("/"), t.id).toBe(true);
      expect(existsSync(path.join(root, "public", t.image.src)), t.image.src).toBe(true);
      expect(t.image.alt.length).toBeGreaterThan(10);
    }
  });

  it("only accepts known ids from the URL", () => {
    expect(isJewelleryType("maang_teeka")).toBe(true);
    expect(isJewelleryType("tiara")).toBe(false);
    expect(isJewelleryType(["ring"])).toBe(false);
  });

  it("has five generator steps", () => {
    expect(GENERATOR_STEPS).toEqual(["Jewellery Type", "Upload Photo", "Choose Style", "Photo Size", "Generate Image"]);
  });
});

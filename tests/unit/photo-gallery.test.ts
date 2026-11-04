import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PHOTO_GALLERY } from "@/content/photo-gallery";
import { STYLE_CATEGORIES } from "@/content/style-previews";

const root = path.resolve(import.meta.dirname, "../..");

describe("homepage photography gallery", () => {
  it("shows the 16 shared photographs, each from this project with alt text", () => {
    expect(PHOTO_GALLERY).toHaveLength(16);
    expect(new Set(PHOTO_GALLERY.map((p) => p.id)).size).toBe(16);
    expect(new Set(PHOTO_GALLERY.map((p) => p.src)).size).toBe(16);
    for (const p of PHOTO_GALLERY) {
      expect(p.src.startsWith("/gallery/"), p.id).toBe(true);
      expect(existsSync(path.join(root, "public", p.src)), p.src).toBe(true);
      expect(p.alt.length).toBeGreaterThan(20);
      expect(STYLE_CATEGORIES.some((c) => c.id === p.category)).toBe(true);
    }
  });
});

import path from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * Embedded fonts (SIL Open Font License, see ./fonts/LICENSE-*):
 * Inter for text, Cormorant Garamond for display, Noto Sans Devanagari as a
 * fallback so Hindi product names render. Inter and Cormorant were merged
 * from their Latin and Latin Extended subsets so ₹ is included.
 * react-pdf embeds only the glyphs used (subsetting), which keeps files small.
 */
const FONT_DIR = path.join(process.cwd(), "src", "server", "pdf", "fonts");

export const FONT = {
  sans: "CatalogueSans",
  display: "CatalogueDisplay",
  devanagari: "CatalogueDevanagari",
} as const;

/** Sans text with Devanagari fallback. */
export const SANS_STACK = [FONT.sans, FONT.devanagari];
export const DISPLAY_STACK = [FONT.display, FONT.devanagari];

let registered = false;

export function registerCatalogueFonts(): void {
  if (registered) return;
  Font.register({
    family: FONT.sans,
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Inter-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: FONT.display,
    fonts: [
      { src: path.join(FONT_DIR, "CormorantGaramond-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "CormorantGaramond-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: FONT.devanagari,
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansDevanagari-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansDevanagari-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  // No dictionary hyphenation (it mangles names and SKUs), but split very long
  // unbroken tokens so they can wrap instead of running off the page.
  Font.registerHyphenationCallback((word) => {
    if (word.length <= 20) return [word];
    const parts: string[] = [];
    for (let i = 0; i < word.length; i += 14) parts.push(word.slice(i, i + 14));
    return parts;
  });
  registered = true;
}

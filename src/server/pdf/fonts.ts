import { Font } from "@react-pdf/renderer";

import { FONT_DATA_URLS } from "./font-data.generated";
import "./pdfkit-standard-fonts";

/**
 * Embedded fonts (SIL Open Font License, see ./fonts/LICENSE-*):
 * Inter for text, Cormorant Garamond for display, Noto Sans Devanagari as a
 * fallback so Hindi product names render. Inter and Cormorant were merged
 * from their Latin and Latin Extended subsets so ₹ is included.
 * react-pdf embeds only the glyphs used (subsetting), which keeps files small.
 */
/**
 * Fonts are embedded in the server bundle as data URLs (font-data.generated.ts),
 * so PDFs render the same on Node and on Cloudflare Workers, which has no
 * filesystem. Regenerate with `node scripts/generate-pdf-font-data.mjs`.
 */
const font = (file: string) => {
  const src = FONT_DATA_URLS[file];
  if (!src) throw new Error(`PDF font ${file} is missing from font-data.generated.ts`);
  return src;
};

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
      { src: font("Inter-Regular.ttf"), fontWeight: 400 },
      { src: font("Inter-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: FONT.display,
    fonts: [
      { src: font("CormorantGaramond-Medium.ttf"), fontWeight: 500 },
      { src: font("CormorantGaramond-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: FONT.devanagari,
    fonts: [
      { src: font("NotoSansDevanagari-Regular.ttf"), fontWeight: 400 },
      { src: font("NotoSansDevanagari-SemiBold.ttf"), fontWeight: 600 },
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

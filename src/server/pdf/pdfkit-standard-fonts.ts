import * as pdfkit from "pdfkit";
import Courier from "pdfkit/standard-fonts/Courier";
import CourierBold from "pdfkit/standard-fonts/CourierBold";
import CourierBoldOblique from "pdfkit/standard-fonts/CourierBoldOblique";
import CourierOblique from "pdfkit/standard-fonts/CourierOblique";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import HelveticaBoldOblique from "pdfkit/standard-fonts/HelveticaBoldOblique";
import HelveticaOblique from "pdfkit/standard-fonts/HelveticaOblique";
import SymbolFont from "pdfkit/standard-fonts/Symbol";
import TimesBold from "pdfkit/standard-fonts/TimesBold";
import TimesBoldItalic from "pdfkit/standard-fonts/TimesBoldItalic";
import TimesItalic from "pdfkit/standard-fonts/TimesItalic";
import TimesRoman from "pdfkit/standard-fonts/TimesRoman";
import ZapfDingbats from "pdfkit/standard-fonts/ZapfDingbats";

/**
 * pdfkit ships two builds:
 * - Node build (Node: next dev/start, scripts): loads its 14 built-in fonts
 *   itself, with a runtime `createRequire(import.meta.url)("#standard-fonts/…")`
 *   that can't be bundled for Cloudflare Workers.
 * - Browser build: no filesystem or Node streams; the built-in fonts must be
 *   registered with registerStdFonts() before a document is opened.
 *
 * The Worker (and the tests, see vitest.config.mts) load pdfkit through
 * js/pdfkit.workerd.mjs, which scripts/patch-pdfkit-workerd.mjs adds: it
 * registers the fonts inside pdfkit before any importer runs. Registering only
 * from app code wasn't enough on Workers: react-pdf's font store could open
 * Helvetica first, leaving unhandled rejections.
 *
 * This module is a safety net (registering twice is harmless) and a no-op under
 * the Node build. Keep it imported before @react-pdf/renderer.
 */
const register = (pdfkit as { registerStdFonts?: (...fonts: unknown[]) => void }).registerStdFonts;
export const PDFKIT_BUILD: "browser" | "node" = typeof register === "function" ? "browser" : "node";
if (register) {
  register(
    Courier,
    CourierBold,
    CourierBoldOblique,
    CourierOblique,
    Helvetica,
    HelveticaBold,
    HelveticaBoldOblique,
    HelveticaOblique,
    SymbolFont,
    TimesBold,
    TimesBoldItalic,
    TimesItalic,
    TimesRoman,
    ZapfDingbats,
  );
}

import { readFileSync } from "node:fs";
import path from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";

import { A4, FOOTER_HEIGHT, imageBox, MARGIN, plannedPageCount } from "@/server/pdf/layout";
import type { PdfCatalogueInput, PdfItem } from "@/server/pdf/model";
import { renderCataloguePdf } from "@/server/pdf/render";

/**
 * Programmatic checks on real rendered PDFs: page count and size, embedded
 * fonts, text positions (nothing outside the page or margins), wrapping,
 * truncation, multipage overflow, prices, and that the PDF contains only
 * text the shop supplied.
 */

const root = path.resolve(import.meta.dirname, "../..");
const demo = (f: string) => new Uint8Array(readFileSync(path.join(root, "public/demo", f)));
const PHOTOS = [
  "tikka-studio.webp",
  "ring-diamond-dark.webp",
  "necklace-silver-display.webp",
  "necklace-pearl-flower.webp",
  "ring-box.webp",
  "earrings-model.webp",
  "bangles-model.webp",
  "bracelet-model.webp",
  "anklets-satin.webp",
  "ring-infinity-model.webp",
].map(demo);

const LONG_DESCRIPTION = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long description supplied for testing.`)
  .join(" ")
  .slice(0, 2000);

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}
interface ParsedPage {
  width: number;
  height: number;
  items: TextItem[];
  text: string;
}

async function parse(pdf: Buffer): Promise<ParsedPage[]> {
  const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const pages: ParsedPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    const content = await page.getTextContent();
    const items = content.items
      .filter((it): it is typeof it & { str: string; transform: number[]; width: number } => "str" in it)
      .filter((it) => it.str.trim() !== "")
      .map((it) => ({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, width: it.width }));
    pages.push({ width: x1 - x0, height: y1 - y0, items, text: items.map((i) => i.str).join(" ").replace(/\s+/g, " ") });
  }
  await task.destroy();
  return pages;
}

function baseInput(overrides: Partial<PdfCatalogueInput> = {}, items?: PdfItem[]): PdfCatalogueInput {
  return {
    catalogueName: "Test Catalogue",
    layout: "grid",
    orientation: "portrait",
    includeCover: true,
    coverTitle: "Cover Title",
    coverSubtitle: "Cover subtitle text",
    showPrices: false,
    priceNote: "",
    includeContactPage: true,
    business: { name: "Test Business", phone: "+91 11111 22222", whatsapp: "", email: "shop@example.com", website: "", address: "" },
    logoBytes: null,
    items:
      items ??
      PHOTOS.map((bytes, i) => ({
        id: `item-${i + 1}`,
        name: `Product ${i + 1}`,
        sku: `SKU-${String(i + 1).padStart(3, "0")}`,
        description: `Description ${i + 1}.`,
        pricePaise: null,
        specs: [],
        imageBytes: bytes,
      })),
    ...overrides,
  };
}

function expectA4(pages: ParsedPage[], orientation: "portrait" | "landscape") {
  for (const p of pages) {
    const [w, h] = orientation === "portrait" ? [A4.width, A4.height] : [A4.height, A4.width];
    expect(p.width).toBeCloseTo(w, 1);
    expect(p.height).toBeCloseTo(h, 1);
  }
}

/** Every text run must sit inside the page's safe margins (footer excepted at the bottom). */
function expectWithinMargins(page: ParsedPage, opts: { coverFullBleed?: boolean } = {}) {
  for (const it of page.items) {
    expect(it.x, `"${it.str}" starts left of the margin`).toBeGreaterThanOrEqual(MARGIN - 1);
    if (!opts.coverFullBleed) {
      expect(it.x + it.width, `"${it.str}" runs past the right margin`).toBeLessThanOrEqual(page.width - MARGIN + 1);
    }
    expect(it.y, `"${it.str}" is below the page`).toBeGreaterThanOrEqual(MARGIN - 20);
    expect(it.y, `"${it.str}" is above the page`).toBeLessThanOrEqual(page.height - MARGIN + 2);
  }
}

function embeddedFontReport(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  const fontDicts = raw.match(/\/Type\s*\/FontDescriptor[\s\S]*?>>/g) ?? [];
  return { descriptors: fontDicts.length, embedded: fontDicts.filter((d) => /\/FontFile2/.test(d)).length };
}

function imageDimensions(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  const dicts = raw.match(/\/Subtype\s*\/Image[\s\S]*?>>/g) ?? [];
  return dicts.map((d) => ({ width: Number(/\/Width\s+(\d+)/.exec(d)?.[1]), height: Number(/\/Height\s+(\d+)/.exec(d)?.[1]) }));
}

describe("catalogue PDF — 10 products, A4 portrait grid", () => {
  let pdf: Buffer;
  let pages: ParsedPage[];
  let pageCount: number;
  const input = baseInput();

  beforeAll(async () => {
    const r = await renderCataloguePdf(input, "print");
    pdf = r.pdf;
    pageCount = r.pageCount;
    pages = await parse(pdf);
  }, 120_000);

  it("has a cover, three product pages (4 + 4 + 2) and a contact page, all A4 portrait", () => {
    expect(pages).toHaveLength(5);
    expect(pageCount).toBe(5);
    expect(plannedPageCount({ ...input, itemCount: 10 })).toBe(5);
    expectA4(pages, "portrait");
    expect(pages[1]!.text).toMatch(/Product 1 .*Product 2 .*Product 3 .*Product 4 /);
    expect(pages[2]!.text).toMatch(/Product 5 .*Product 8 /);
    expect(pages[3]!.text).toMatch(/Product 9 .*Product 10 /);
    expect(pages[3]!.text).not.toMatch(/Product 1 /);
    expect(pages[4]!.text).toMatch(/Contact .*Test Business .*\+91 11111 22222 .*shop@example\.com/);
  });

  it("numbers every page after the cover", () => {
    expect(pages[0]!.text).not.toMatch(/\d \/ 5/);
    for (let i = 1; i < 5; i++) expect(pages[i]!.text).toContain(`${i + 1} / 5`);
  });

  it("keeps all text inside the margins", () => {
    pages.forEach((p) => expectWithinMargins(p));
  });

  it("embeds every font", () => {
    const f = embeddedFontReport(pdf);
    expect(f.descriptors).toBeGreaterThan(0);
    expect(f.embedded).toBe(f.descriptors);
  });

  it("downsamples images to 300 DPI for their box and keeps the file small", () => {
    const box = imageBox("grid", "portrait");
    const maxW = Math.ceil((box.width / 72) * 300);
    const maxH = Math.ceil((box.height / 72) * 300);
    const dims = imageDimensions(pdf).filter((d) => d.width && d.height);
    expect(dims.length).toBeGreaterThanOrEqual(10);
    // Product images (cover may be larger) never exceed their box at 300 DPI, except the one cover image.
    const oversized = dims.filter((d) => d.width > maxW || d.height > maxH);
    expect(oversized.length).toBeLessThanOrEqual(1);
    expect(pdf.byteLength).toBeLessThan(6 * 1024 * 1024);
  });
});

describe("catalogue PDF — layouts, wrapping and page breaks", () => {
  it("landscape grid fits 6 per page: cover + 2 product pages + contact", async () => {
    const r = await renderCataloguePdf(baseInput({ orientation: "landscape" }), "print");
    const pages = await parse(r.pdf);
    expect(pages).toHaveLength(4);
    expectA4(pages, "landscape");
    expect(pages[1]!.text).toMatch(/Product 1 .*Product 6 /);
    expect(pages[2]!.text).toMatch(/Product 7 .*Product 10 /);
    pages.slice(1).forEach((p) => expectWithinMargins(p));
  }, 120_000);

  it("editorial puts one product per page", async () => {
    const r = await renderCataloguePdf(baseInput({ layout: "editorial" }), "preview");
    const pages = await parse(r.pdf);
    expect(pages).toHaveLength(12);
    for (let i = 1; i <= 10; i++) expect(pages[i]!.text).toContain(`Product ${i} `);
  }, 120_000);

  for (const orientation of ["portrait", "landscape"] as const) {
    it(`editorial ${orientation}: a 2,000-character description and 12 specs wrap and continue onto the next page`, async () => {
      const items: PdfItem[] = [
        {
          id: "long",
          name: "Long product",
          sku: "LONG-1",
          description: LONG_DESCRIPTION,
          pricePaise: null,
          specs: Array.from({ length: 12 }, (_, i) => ({ label: `Spec ${i + 1}`, value: `Value ${i + 1}` })),
          imageBytes: PHOTOS[0]!,
        },
        { id: "next", name: "Next product", sku: "", description: "", pricePaise: null, specs: [], imageBytes: PHOTOS[1]! },
      ];
      const r = await renderCataloguePdf(baseInput({ layout: "editorial", orientation, includeCover: false, includeContactPage: false }, items), "preview");
      const pages = await parse(r.pdf);

      // The long product needs more than one page; the next product starts on a fresh page.
      expect(pages.length).toBeGreaterThanOrEqual(3);
      const nextIndex = pages.findIndex((p) => p.text.includes("Next product"));
      expect(nextIndex).toBeGreaterThanOrEqual(2);

      // Nothing is lost: every sentence and every spec appears, in order, before the next product.
      const longText = pages.slice(0, nextIndex).map((p) => p.text).join(" ");
      expect(longText).toContain("Sentence 1 of");
      expect(longText).toContain("Sentence 33 of");
      expect(longText).toContain("Spec 12: Value 12");
      expect(longText.indexOf("Sentence 1 of")).toBeLessThan(longText.indexOf("Spec 1:"));

      pages.forEach((p) => expectWithinMargins(p));
      expectA4(pages, orientation);
    }, 120_000);
  }

  it("grid clamps long names, SKUs, descriptions and spec lists without spilling into other cells", async () => {
    const items: PdfItem[] = PHOTOS.slice(0, 4).map((bytes, i) => ({
      id: `c${i}`,
      name: i === 0 ? "An extremely long product name that goes on and on well beyond two lines of the grid cell width" : `Item ${i}`,
      sku: i === 0 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ" : `S-${i}`,
      description: i === 0 ? LONG_DESCRIPTION : "Short.",
      pricePaise: null,
      specs: i === 0 ? Array.from({ length: 8 }, (_, k) => ({ label: `Spec ${k + 1}`, value: `Value ${k + 1}` })) : [],
      imageBytes: bytes,
    }));
    const r = await renderCataloguePdf(baseInput({ includeCover: false, includeContactPage: false }, items), "preview");
    const pages = await parse(r.pdf);
    expect(pages).toHaveLength(1); // clamping keeps it to one page
    const p = pages[0]!;
    expectWithinMargins(p);
    expect(p.text).toContain("…"); // truncation is visible, not silent
    expect(p.text).not.toContain("Sentence 30 of");
    expect(p.text).toContain("+5 more"); // 8 specs, 3 shown
    // Text from the first cell stays in the left column.
    const cellRight = MARGIN + (p.width - 2 * MARGIN - 16) / 2;
    for (const it of p.items.filter((t) => t.str.includes("Sentence") || t.str.includes("extremely"))) {
      expect(it.x + it.width).toBeLessThanOrEqual(cellRight + 1);
    }
  }, 120_000);
});

describe("catalogue PDF — content rules", () => {
  it("shows supplied prices with ₹ and the shop's own note for unpriced items", async () => {
    const items = baseInput().items.slice(0, 3);
    items[0] = { ...items[0]!, pricePaise: 12_345_000 };
    items[1] = { ...items[1]!, pricePaise: 149_950 };
    const r = await renderCataloguePdf(baseInput({ showPrices: true, priceNote: "Price on request", includeCover: false }, items), "preview");
    const text = (await parse(r.pdf)).map((p) => p.text).join(" ");
    expect(text).toContain("₹1,23,450");
    expect(text).toContain("₹1,499.50");
    expect(text).toContain("Price on request");
  }, 120_000);

  it("never shows prices when prices are off, even if they're saved", async () => {
    const items = baseInput().items.slice(0, 2).map((i) => ({ ...i, pricePaise: 500_000 }));
    const r = await renderCataloguePdf(baseInput({ showPrices: false }, items), "preview");
    const text = (await parse(r.pdf)).map((p) => p.text).join(" ");
    expect(text).not.toContain("₹");
  }, 120_000);

  it("contains only text the shop supplied, plus page numbers and the missing-image label", async () => {
    const items: PdfItem[] = [
      { id: "a", name: "Alpha", sku: "", description: "", pricePaise: null, specs: [], imageBytes: PHOTOS[0]! },
      { id: "b", name: "", sku: "B-2", description: "", pricePaise: null, specs: [], imageBytes: null },
      { id: "c", name: "Gamma", sku: "", description: "Only this.", pricePaise: null, specs: [{ label: "Size", value: "Free" }], imageBytes: PHOTOS[2]! },
    ];
    const input = baseInput(
      {
        coverTitle: "",
        coverSubtitle: "",
        business: { name: "", phone: "", whatsapp: "", email: "", website: "", address: "" },
        catalogueName: "Plain",
      },
      items,
    );
    const r = await renderCataloguePdf(input, "preview");
    const pages = await parse(r.pdf);
    expect(pages).toHaveLength(2); // no contact page without contact details
    const allowed = new Set(["Plain", "Alpha", "B-2", "Gamma", "Only this.", "Size:", "Size: ", "Free", "Size: Free", "Image unavailable", "1 / 2", "2 / 2"]);
    const tokens = pages.flatMap((p) => p.items.map((i) => i.str.trim()));
    const unexpected = tokens.filter((t) => !allowed.has(t) && !/^\d+ \/ \d+$/.test(t));
    expect(unexpected).toEqual([]);
    expect(r.missingImageItemIds).toEqual(["b"]);
  }, 120_000);

  it("renders Hindi product names with an embedded Devanagari font", async () => {
    const items: PdfItem[] = [{ id: "h", name: "कुंदन हार सेट", sku: "HI-1", description: "", pricePaise: null, specs: [], imageBytes: PHOTOS[0]! }];
    const r = await renderCataloguePdf(baseInput({ includeCover: false, includeContactPage: false }, items), "preview");
    const raw = r.pdf.toString("latin1");
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSansDevanagari/);
    expect(embeddedFontReport(r.pdf).embedded).toBe(embeddedFontReport(r.pdf).descriptors);
  }, 120_000);

  it("survives a corrupt image by drawing the placeholder", async () => {
    const items: PdfItem[] = [{ id: "x", name: "Broken", sku: "", description: "", pricePaise: null, specs: [], imageBytes: new TextEncoder().encode("not an image") }];
    const r = await renderCataloguePdf(baseInput({ includeCover: false, includeContactPage: false }, items), "preview");
    expect(r.missingImageItemIds).toEqual(["x"]);
    expect((await parse(r.pdf))[0]!.text).toContain("Image unavailable");
  }, 120_000);

  it("produces a smaller preview than the print file", async () => {
    const input = baseInput();
    const [print, preview] = await Promise.all([renderCataloguePdf(input, "print"), renderCataloguePdf(input, "preview")]);
    expect(preview.pdf.byteLength).toBeLessThan(print.pdf.byteLength);
    expect(preview.pageCount).toBe(print.pageCount);
  }, 120_000);

  it("handles an empty catalogue", async () => {
    const r = await renderCataloguePdf(baseInput({ includeContactPage: false }, []), "preview");
    const pages = await parse(r.pdf);
    expect(pages).toHaveLength(2);
    expect(pages[1]!.text).toContain("This catalogue has no products yet.");
  }, 120_000);
});

// Footer sits inside the bottom margin band; keep the constant referenced so layout changes are deliberate.
void FOOTER_HEIGHT;

// Must load before react-pdf opens any document (registers pdfkit's built-in fonts).
import "@/server/pdf/pdfkit-standard-fonts";
import { renderToBuffer } from "@react-pdf/renderer";
import { readImageHeader } from "@/server/imaging/header";
import { imageProcessor } from "@/server/imaging/processor";

import { CatalogueDocument, type CatalogueAssets } from "./catalogue-document";
import { registerCatalogueFonts } from "./fonts";
import { coverImageBox, imageBox, plannedPageCount } from "./layout";
import type { PdfCatalogueInput, PreparedImage, RenderQuality } from "./model";

/**
 * Image sizing: each image is resampled to the pixel size it needs for the
 * box it's drawn in — 300 DPI for print, ~110 DPI for on-screen preview —
 * and never enlarged. Opaque images become high-quality JPEG (4:4:4 chroma,
 * so fine metalwork and stone edges stay crisp); logos with transparency stay
 * PNG. This keeps a 10-product catalogue to a few MB instead of tens.
 */
/** Same pixel ceiling sharp enforced before (limitInputPixels: 60M). */
const PDF_IMAGE_MAX_PIXELS = 60_000_000;

const PROFILE: Record<RenderQuality, { dpi: number; jpegQuality: number }> = {
  print: { dpi: 300, jpegQuality: 88 },
  preview: { dpi: 110, jpegQuality: 72 },
};

export async function prepareImage(
  bytes: Uint8Array | null,
  boxPt: { width: number; height: number },
  quality: RenderQuality,
  opts: { keepAlpha?: boolean } = {},
): Promise<PreparedImage | null> {
  if (!bytes || bytes.byteLength === 0) return null;
  const { dpi, jpegQuality } = PROFILE[quality];
  const maxW = Math.ceil((boxPt.width / 72) * dpi);
  const maxH = Math.ceil((boxPt.height / 72) * dpi);
  try {
    const meta = readImageHeader(bytes);
    if (meta.width * meta.height > PDF_IMAGE_MAX_PIXELS) return null;
    const fitInside = { width: maxW, height: maxH };
    if (opts.keepAlpha && meta.hasAlpha) {
      const out = await imageProcessor().transform(bytes, { fitInside, output: { format: "png" } });
      return { data: Buffer.from(out.bytes), format: "png", width: out.width, height: out.height };
    }
    const out = await imageProcessor().transform(bytes, {
      fitInside,
      background: "#ffffff",
      output: { format: "jpeg", quality: jpegQuality, fullChroma: true },
    });
    return { data: Buffer.from(out.bytes), format: "jpg", width: out.width, height: out.height };
  } catch {
    // Corrupt or unreadable image: the page shows "Image unavailable" instead of failing the export.
    return null;
  }
}

export interface RenderResult {
  pdf: Buffer;
  pageCount: number;
  /** Items drawn with the "Image unavailable" placeholder. */
  missingImageItemIds: string[];
}

function countPages(pdf: Buffer): number {
  // react-pdf writes plain (uncompressed) page objects; count /Type /Page (not /Pages).
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

export async function renderCataloguePdf(input: PdfCatalogueInput, quality: RenderQuality = "print"): Promise<RenderResult> {
  registerCatalogueFonts();

  const box = imageBox(input.layout, input.orientation);
  const items = new Map<string, PreparedImage | null>();
  // Sequential keeps peak memory low for large catalogues.
  for (const item of input.items) {
    items.set(item.id, await prepareImage(item.imageBytes, box, quality));
  }

  const coverSource = input.items.find((i) => i.imageBytes && items.get(i.id));
  const cover = input.includeCover && coverSource ? await prepareImage(coverSource.imageBytes, coverImageBox(input.orientation), quality) : null;
  const logo = await prepareImage(input.logoBytes, { width: 160, height: 60 }, quality, { keepAlpha: true });

  const assets: CatalogueAssets = { items, cover, logo };
  const pdf = await renderToBuffer(<CatalogueDocument input={input} assets={assets} />);

  return {
    pdf,
    pageCount: countPages(pdf),
    missingImageItemIds: input.items.filter((i) => !items.get(i.id)).map((i) => i.id),
  };
}

export { plannedPageCount };

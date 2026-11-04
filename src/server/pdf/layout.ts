import type { CatalogueLayout, CatalogueOrientation } from "@/lib/catalogue";

import type { PdfBusiness } from "./model";

/** PostScript points (1/72 inch). */
export const MM = 72 / 25.4;
export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 15 * MM; // 42.52 pt safe area on every side
export const FOOTER_HEIGHT = 22;
export const GAP = 16;

export function pageSize(orientation: CatalogueOrientation) {
  return orientation === "portrait" ? { width: A4.width, height: A4.height } : { width: A4.height, height: A4.width };
}

export interface GridSpec {
  cols: number;
  rows: number;
  cellWidth: number;
  rowHeight: number;
  imageHeight: number;
  clamp: { name: number; description: number; specs: number };
}

export function gridSpec(orientation: CatalogueOrientation): GridSpec {
  const { width, height } = pageSize(orientation);
  const cols = orientation === "portrait" ? 2 : 3;
  const rows = 2;
  const cellWidth = (width - 2 * MARGIN - (cols - 1) * GAP) / cols;
  const rowHeight = (height - 2 * MARGIN - FOOTER_HEIGHT - (rows - 1) * GAP) / rows;
  // Reserve a fixed text area so clamped text can never push into the next row.
  const textArea = orientation === "portrait" ? 150 : 112;
  return {
    cols,
    rows,
    cellWidth,
    rowHeight,
    imageHeight: rowHeight - textArea,
    clamp: orientation === "portrait" ? { name: 2, description: 4, specs: 3 } : { name: 2, description: 2, specs: 2 },
  };
}

export function itemsPerPage(layout: CatalogueLayout, orientation: CatalogueOrientation): number {
  if (layout === "editorial") return 1;
  const g = gridSpec(orientation);
  return g.cols * g.rows;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Box (in points) each image is drawn into, used to size images for print. */
export function imageBox(layout: CatalogueLayout, orientation: CatalogueOrientation) {
  const { width, height } = pageSize(orientation);
  if (layout === "grid") {
    const g = gridSpec(orientation);
    return { width: g.cellWidth, height: g.imageHeight };
  }
  const contentHeight = height - 2 * MARGIN - FOOTER_HEIGHT;
  return orientation === "portrait"
    ? { width: width - 2 * MARGIN, height: contentHeight * 0.56 }
    : { width: (width - 2 * MARGIN) * 0.56, height: contentHeight };
}

export function coverImageBox(orientation: CatalogueOrientation) {
  const { width, height } = pageSize(orientation);
  return orientation === "portrait" ? { width: width - 2 * MARGIN, height: height * 0.5 } : { width: width * 0.5, height };
}

export function hasContactDetails(b: PdfBusiness): boolean {
  return [b.phone, b.whatsapp, b.email, b.website, b.address].some((v) => v.trim() !== "");
}

/** Expected page count before rendering (editorial pages can grow if text overflows). */
export function plannedPageCount(input: {
  layout: CatalogueLayout;
  orientation: CatalogueOrientation;
  itemCount: number;
  includeCover: boolean;
  includeContactPage: boolean;
  business: PdfBusiness;
}): number {
  const productPages = Math.max(1, Math.ceil(input.itemCount / itemsPerPage(input.layout, input.orientation)));
  return (input.includeCover ? 1 : 0) + productPages + (input.includeContactPage && hasContactDetails(input.business) ? 1 : 0);
}

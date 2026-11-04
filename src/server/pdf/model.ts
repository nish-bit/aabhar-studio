import type { CatalogueLayout, CatalogueOrientation, CatalogueSpec } from "@/lib/catalogue";

/**
 * Everything the PDF needs, already resolved from the database. Only shop-
 * supplied text and approved images end up here — the renderer adds nothing
 * except layout, page numbers and the "Image unavailable" placeholder.
 */

export interface PreparedImage {
  data: Buffer;
  format: "jpg" | "png";
  width: number;
  height: number;
}

export interface PdfBusiness {
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
}

export interface PdfItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  pricePaise: number | null;
  specs: CatalogueSpec[];
  /** Raw bytes of the approved image, or null if it's missing. */
  imageBytes: Uint8Array | null;
}

export interface PdfCatalogueInput {
  catalogueName: string;
  layout: CatalogueLayout;
  orientation: CatalogueOrientation;
  includeCover: boolean;
  coverTitle: string;
  coverSubtitle: string;
  showPrices: boolean;
  priceNote: string;
  includeContactPage: boolean;
  business: PdfBusiness;
  logoBytes: Uint8Array | null;
  items: PdfItem[];
}

export type RenderQuality = "print" | "preview";

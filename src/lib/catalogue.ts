import { z } from "zod";

/**
 * Catalogue contracts and validation, shared by the browser and the server.
 * Every product field is optional and supplied by the shop — the app never
 * fills in prices, materials, weights, grades or certifications.
 */

export const CATALOGUE_LIMITS = {
  maxItems: 100,
  nameMax: 120,
  skuMax: 60,
  descriptionMax: 2000,
  specsMax: 12,
  specLabelMax: 40,
  specValueMax: 120,
  coverTitleMax: 120,
  coverSubtitleMax: 200,
  priceNoteMax: 60,
  /** ₹10,00,00,000 (10 crore) in paise. */
  maxPricePaise: 100_000_000_000,
} as const;

export type CatalogueLayout = "grid" | "editorial";
export type CatalogueOrientation = "portrait" | "landscape";

export interface CatalogueSpec {
  label: string;
  value: string;
}

export interface CatalogueSummary {
  id: string;
  name: string;
  layout: CatalogueLayout;
  orientation: CatalogueOrientation;
  itemCount: number;
  coverThumbUrl: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CatalogueItemView {
  id: string;
  position: number;
  generatedImageId: string | null;
  /** Short-lived signed URL, null when the image is missing. */
  imageUrl: string | null;
  name: string;
  sku: string;
  description: string;
  pricePaise: number | null;
  specs: CatalogueSpec[];
}

export interface CatalogueSettings {
  name: string;
  layout: CatalogueLayout;
  orientation: CatalogueOrientation;
  coverTitle: string;
  coverSubtitle: string;
  showPrices: boolean;
  priceNote: string;
  includeCover: boolean;
  includeContactPage: boolean;
}

export interface CatalogueView extends CatalogueSettings {
  id: string;
  version: number;
  updatedAt: string;
  items: CatalogueItemView[];
  /** Problems the shop should fix before exporting (missing images, no contact details…). */
  warnings: string[];
}

export interface ApprovedImageView {
  generatedImageId: string;
  url: string;
  fileName: string;
  presetSlug: string;
  approvedAt: string | null;
}

export interface BusinessProfileView {
  businessName: string;
  logoUrl: string | null;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
}

export interface CatalogueExportView {
  id: string;
  kind: "pdf" | "images_zip";
  url: string;
  bytes: number;
  pageCount: number | null;
  createdAt: string;
}

/* ------------------------------------------------------------ schemas */

const text = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} can be up to ${max} characters.`)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim());

export const catalogueNameSchema = text(CATALOGUE_LIMITS.nameMax, "Name").pipe(
  z.string().min(1, "Give the catalogue a name."),
);

export const catalogueSettingsPatchSchema = z
  .object({
    name: catalogueNameSchema,
    layout: z.enum(["grid", "editorial"]),
    orientation: z.enum(["portrait", "landscape"]),
    coverTitle: text(CATALOGUE_LIMITS.coverTitleMax, "Cover title"),
    coverSubtitle: text(CATALOGUE_LIMITS.coverSubtitleMax, "Cover subtitle"),
    showPrices: z.boolean(),
    priceNote: text(CATALOGUE_LIMITS.priceNoteMax, "Price note"),
    includeCover: z.boolean(),
    includeContactPage: z.boolean(),
  })
  .partial();

export type CatalogueSettingsPatch = z.infer<typeof catalogueSettingsPatchSchema>;

export const specSchema = z.object({
  label: text(CATALOGUE_LIMITS.specLabelMax, "Specification name"),
  value: text(CATALOGUE_LIMITS.specValueMax, "Specification value"),
});

export const itemPatchSchema = z
  .object({
    name: text(CATALOGUE_LIMITS.nameMax, "Product name"),
    sku: text(CATALOGUE_LIMITS.skuMax, "SKU"),
    description: text(CATALOGUE_LIMITS.descriptionMax, "Description"),
    pricePaise: z
      .number()
      .int("Price must be a whole number of paise.")
      .min(0, "Price can't be negative.")
      .max(CATALOGUE_LIMITS.maxPricePaise, "That price is too large.")
      .nullable(),
    specs: z
      .array(specSchema)
      .max(CATALOGUE_LIMITS.specsMax, `Up to ${CATALOGUE_LIMITS.specsMax} specifications.`)
      // Drop empty rows instead of storing blanks.
      .transform((rows) => rows.filter((r) => r.label || r.value)),
  })
  .partial();

export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const businessProfilePatchSchema = z
  .object({
    businessName: text(120, "Business name"),
    phone: text(40, "Phone"),
    whatsapp: text(40, "WhatsApp"),
    email: text(200, "Email").pipe(z.union([z.literal(""), z.email("Enter a valid email address.")])),
    website: text(200, "Website"),
    address: text(500, "Address"),
  })
  .partial();

export type BusinessProfilePatch = z.infer<typeof businessProfilePatchSchema>;

/* ------------------------------------------------------------ helpers */

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** ₹ with Indian digit grouping; shows paise only when non-zero. */
export function formatPricePaise(paise: number): string {
  return paise % 100 === 0 ? inr.format(paise / 100) : inrPaise.format(paise / 100);
}

/** Parse what a shop owner types ("1,23,450", "₹ 1499.50") into paise. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

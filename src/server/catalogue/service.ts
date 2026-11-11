import { randomUUID } from "node:crypto";

import { zipSync } from "fflate";

import {
  CATALOGUE_LIMITS,
  type ApprovedImageView,
  type BusinessProfilePatch,
  type BusinessProfileView,
  type CatalogueExportView,
  type CatalogueSettingsPatch,
  type CatalogueSummary,
  type CatalogueView,
  type ItemPatch,
} from "@/lib/catalogue";
import type { PlanLimits } from "@/config/billing";
import { membershipOrOnboard } from "@/server/auth/ensure-shop";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { BUCKETS, type ObjectStorage } from "@/server/generation/ports";
import { hasContactDetails } from "@/server/pdf/layout";
import type { PdfCatalogueInput, RenderQuality } from "@/server/pdf/model";
import { renderCataloguePdf } from "@/server/pdf/render";
import { ImageHeaderError, orientedSize, readImageHeader } from "@/server/imaging/header";
import { imageProcessor } from "@/server/imaging/processor";
import { sniffImageType } from "@/server/imaging/validate";

import { CatalogueRepository, type CatalogueItemRow, type CatalogueRow } from "./repository";

export interface CatalogueDeps {
  repo: CatalogueRepository;
  storage: ObjectStorage;
  /** Plan limits from billing. When absent, only the built-in CATALOGUE_LIMITS apply. */
  entitlements?: ((shopId: string) => Promise<PlanLimits>) | null;
}

/** Refuses a new (or restored) catalogue when the plan's catalogue allowance is used up. */
async function assertCatalogueRoom(deps: CatalogueDeps, shopId: string) {
  if (!deps.entitlements) return;
  const plan = await deps.entitlements(shopId);
  if ((await deps.repo.countActive(shopId)) >= plan.maxCatalogues) {
    throw new DomainError(
      "plan_limit",
      `Your plan includes ${plan.maxCatalogues} ${plan.maxCatalogues === 1 ? "catalogue" : "catalogues"}. Delete one or upgrade to add more.`,
      403,
    );
  }
}

async function maxItemsFor(deps: CatalogueDeps, shopId: string) {
  if (!deps.entitlements) return CATALOGUE_LIMITS.maxItems;
  return Math.min(CATALOGUE_LIMITS.maxItems, (await deps.entitlements(shopId)).maxCatalogueItems);
}

const THUMB_TTL = 600;
const conflict = () =>
  new DomainError("conflict", "This catalogue was changed in another window. Reload to see the latest version.", 409);

async function shopFor(deps: CatalogueDeps, userId: string, write: boolean) {
  const m = await membershipOrOnboard(() => deps.repo.membership(userId), () => deps.repo.ensureUserShop(userId));
  if (write && m.role === "viewer") throw domainErrors.forbidden();
  return m.shopId;
}

async function requireCatalogue(deps: CatalogueDeps, shopId: string, id: string): Promise<CatalogueRow> {
  const c = await deps.repo.get(shopId, id);
  if (!c) throw domainErrors.notFound("Catalogue");
  return c;
}

/* ------------------------------------------------------------ catalogues */

export async function listCatalogues(deps: CatalogueDeps, userId: string, deleted = false): Promise<CatalogueSummary[]> {
  const shopId = await shopFor(deps, userId, false);
  const rows = await deps.repo.list(shopId, deleted);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      layout: r.layout,
      orientation: r.orientation,
      itemCount: r.itemCount,
      coverThumbUrl: r.coverPath ? await deps.storage.signedUrl(BUCKETS.generated, r.coverPath, THUMB_TTL).catch(() => null) : null,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    })),
  );
}

export async function createCatalogue(deps: CatalogueDeps, userId: string, name: string) {
  const shopId = await shopFor(deps, userId, true);
  await assertCatalogueRoom(deps, shopId);
  const c = await deps.repo.create(shopId, userId, name);
  return getCatalogue(deps, userId, c.id);
}

export async function getCatalogue(deps: CatalogueDeps, userId: string, id: string): Promise<CatalogueView> {
  const shopId = await shopFor(deps, userId, false);
  const c = await requireCatalogue(deps, shopId, id);
  const [items, profile] = await Promise.all([deps.repo.items(shopId, id), deps.repo.businessProfile(shopId)]);

  const itemViews = await Promise.all(
    items.map(async (i) => ({
      id: i.id,
      position: i.position,
      generatedImageId: i.generatedImageId,
      imageUrl: i.imagePath ? await deps.storage.signedUrl(BUCKETS.generated, i.imagePath, THUMB_TTL).catch(() => null) : null,
      name: i.name,
      sku: i.sku,
      description: i.description,
      pricePaise: i.pricePaise,
      specs: i.specs,
    })),
  );

  return {
    id: c.id,
    version: c.version,
    updatedAt: c.updatedAt,
    name: c.name,
    layout: c.layout,
    orientation: c.orientation,
    coverTitle: c.coverTitle,
    coverSubtitle: c.coverSubtitle,
    showPrices: c.showPrices,
    priceNote: c.priceNote,
    includeCover: c.includeCover,
    includeContactPage: c.includeContactPage,
    items: itemViews,
    warnings: catalogueWarnings(c, items, profile),
  };
}

export function catalogueWarnings(
  c: Pick<CatalogueRow, "showPrices" | "priceNote" | "includeContactPage">,
  items: Pick<CatalogueItemRow, "imagePath" | "name" | "pricePaise">[],
  profile: { businessName: string; phone: string; whatsapp: string; email: string; website: string; address: string },
): string[] {
  const w: string[] = [];
  if (items.length === 0) w.push("Add approved images to build the catalogue.");
  const missing = items.filter((i) => !i.imagePath).length;
  if (missing) w.push(`${missing} ${missing === 1 ? "product has" : "products have"} no image and will show “Image unavailable”.`);
  const unnamed = items.filter((i) => !i.name.trim()).length;
  if (unnamed) w.push(`${unnamed} ${unnamed === 1 ? "product has" : "products have"} no name.`);
  if (c.showPrices && !c.priceNote) {
    const noPrice = items.filter((i) => i.pricePaise === null).length;
    if (noPrice) w.push(`${noPrice} ${noPrice === 1 ? "product has" : "products have"} no price; nothing will be shown for ${noPrice === 1 ? "it" : "them"}.`);
  }
  if (!profile.businessName.trim()) w.push("Add your business name in Business details so it appears on the cover.");
  if (c.includeContactPage && !hasContactDetails({ name: profile.businessName, ...profile })) {
    w.push("The contact page will be skipped until you add contact details in Business details.");
  }
  return w;
}

export async function updateCatalogueSettings(
  deps: CatalogueDeps,
  userId: string,
  id: string,
  expectedVersion: number,
  patch: CatalogueSettingsPatch,
) {
  const shopId = await shopFor(deps, userId, true);
  const updated = await deps.repo.updateSettings(shopId, id, expectedVersion, patch);
  if (!updated) {
    await requireCatalogue(deps, shopId, id); // 404 if it doesn't exist or isn't theirs
    throw conflict();
  }
  return { version: updated.version, updatedAt: updated.updatedAt };
}

export async function duplicateCatalogue(deps: CatalogueDeps, userId: string, id: string) {
  const shopId = await shopFor(deps, userId, true);
  const source = await requireCatalogue(deps, shopId, id);
  await assertCatalogueRoom(deps, shopId);
  const name = `Copy of ${source.name}`.slice(0, CATALOGUE_LIMITS.nameMax);
  const copy = await deps.repo.duplicate(shopId, userId, id, name);
  if (!copy) throw domainErrors.notFound("Catalogue");
  return getCatalogue(deps, userId, copy.id);
}

export async function deleteCatalogue(deps: CatalogueDeps, userId: string, id: string) {
  const shopId = await shopFor(deps, userId, true);
  if (!(await deps.repo.softDelete(shopId, id))) throw domainErrors.notFound("Catalogue");
}

export async function restoreCatalogue(deps: CatalogueDeps, userId: string, id: string) {
  const shopId = await shopFor(deps, userId, true);
  await assertCatalogueRoom(deps, shopId);
  if (!(await deps.repo.restore(shopId, id))) throw domainErrors.notFound("Catalogue");
  return getCatalogue(deps, userId, id);
}

/* ------------------------------------------------------------------ items */

export async function addCatalogueItems(deps: CatalogueDeps, userId: string, id: string, generatedImageIds: string[]) {
  const shopId = await shopFor(deps, userId, true);
  const maxItems = await maxItemsFor(deps, shopId);
  try {
    const result = await deps.repo.addItems(shopId, id, generatedImageIds, maxItems);
    return { ...result, catalogue: await getCatalogue(deps, userId, id) };
  } catch (err) {
    if (err instanceof Error && err.message === "catalogue_not_found") throw domainErrors.notFound("Catalogue");
    if (err instanceof Error && err.message === "too_many_items") {
      throw new DomainError(
        maxItems < CATALOGUE_LIMITS.maxItems ? "plan_limit" : "invalid_request",
        `Your plan allows up to ${maxItems} products per catalogue.`,
        maxItems < CATALOGUE_LIMITS.maxItems ? 403 : 400,
      );
    }
    throw err;
  }
}

export async function updateCatalogueItem(deps: CatalogueDeps, userId: string, id: string, itemId: string, patch: ItemPatch) {
  const shopId = await shopFor(deps, userId, true);
  if (!(await deps.repo.updateItem(shopId, id, itemId, patch))) throw domainErrors.notFound("Product");
}

export async function removeCatalogueItem(deps: CatalogueDeps, userId: string, id: string, itemId: string) {
  const shopId = await shopFor(deps, userId, true);
  if (!(await deps.repo.removeItem(shopId, id, itemId))) throw domainErrors.notFound("Product");
}

export async function reorderCatalogueItems(deps: CatalogueDeps, userId: string, id: string, itemIds: string[]) {
  const shopId = await shopFor(deps, userId, true);
  const result = await deps.repo.reorder(shopId, id, itemIds);
  if (result === "not_found") throw domainErrors.notFound("Catalogue");
  if (result === "mismatch") throw new DomainError("conflict", "The product list changed. Reload and try again.", 409);
}

export async function listApprovedImages(
  deps: CatalogueDeps,
  userId: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<ApprovedImageView[]> {
  const shopId = await shopFor(deps, userId, false);
  const rows = await deps.repo.approvedImages(shopId, Math.min(opts.limit ?? 60, 100), opts.before ?? null);
  return Promise.all(
    rows.map(async (r) => ({
      generatedImageId: r.generatedImageId,
      url: await deps.storage.signedUrl(BUCKETS.generated, r.storagePath, THUMB_TTL),
      fileName: r.fileName,
      presetSlug: r.presetSlug,
      approvedAt: r.reviewedAt,
    })),
  );
}

/* ------------------------------------------------------- business profile */

export async function getBusinessProfile(deps: CatalogueDeps, userId: string): Promise<BusinessProfileView> {
  const shopId = await shopFor(deps, userId, false);
  const p = await deps.repo.businessProfile(shopId);
  return {
    businessName: p.businessName,
    logoUrl: p.logoPath ? await deps.storage.signedUrl(BUCKETS.brandAssets, p.logoPath, THUMB_TTL).catch(() => null) : null,
    phone: p.phone,
    whatsapp: p.whatsapp,
    email: p.email,
    website: p.website,
    address: p.address,
  };
}

export async function updateBusinessProfile(deps: CatalogueDeps, userId: string, patch: BusinessProfilePatch) {
  const shopId = await shopFor(deps, userId, true);
  await deps.repo.updateBusinessProfile(shopId, patch);
  return getBusinessProfile(deps, userId);
}

export const LOGO_LIMITS = { maxBytes: 2 * 1024 * 1024, maxDimension: 2000, minDimension: 64 } as const;

export async function signLogoUpload(deps: CatalogueDeps, userId: string, input: { mimeType: string; sizeBytes: number }) {
  const shopId = await shopFor(deps, userId, true);
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)) {
    throw new DomainError("invalid_file", "Upload your logo as PNG, JPG or WebP.", 400);
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > LOGO_LIMITS.maxBytes) {
    throw new DomainError("invalid_file", "Logos must be 2 MB or smaller.", 400);
  }
  const path = `${shopId}/logo-upload-${randomUUID()}`;
  const signed = await deps.storage.createSignedUploadUrl(BUCKETS.brandAssets, path);
  return { bucket: BUCKETS.brandAssets, path: signed.path, token: signed.token };
}

/** Same pixel ceiling sharp enforced before (limitInputPixels: 20M). */
const LOGO_MAX_PIXELS = 20_000_000;

/** Validate the uploaded logo, re-encode it (keeping transparency) and save it. */
export async function completeLogoUpload(deps: CatalogueDeps, userId: string, uploadPath: string) {
  const shopId = await shopFor(deps, userId, true);
  if (!uploadPath.startsWith(`${shopId}/logo-upload-`) || uploadPath.includes("..")) throw domainErrors.forbidden();

  const raw = await deps.storage.download(BUCKETS.brandAssets, uploadPath).catch(() => {
    throw new DomainError("invalid_request", "We couldn't find the uploaded logo. Please upload it again.", 400);
  });
  try {
    if (raw.byteLength > LOGO_LIMITS.maxBytes || !sniffImageType(raw)) {
      throw new DomainError("invalid_file", "That file isn't a PNG, JPG or WebP image under 2 MB.", 400);
    }
    let header;
    try {
      header = readImageHeader(raw);
    } catch (err) {
      if (err instanceof ImageHeaderError) throw new DomainError("invalid_file", "We couldn't read that image. Export it again as PNG or JPG.", 400);
      throw err;
    }
    if (header.width * header.height > LOGO_MAX_PIXELS) {
      throw new DomainError("invalid_file", "That logo image is too large. Use one under 20 megapixels.", 400);
    }
    const shown = orientedSize(header);
    if (Math.max(shown.width, shown.height) < LOGO_LIMITS.minDimension) {
      throw new DomainError("invalid_file", "Your logo is too small. Use one at least 64px wide.", 400);
    }
    const png = await imageProcessor().transform(raw, {
      fitInside: { width: LOGO_LIMITS.maxDimension, height: LOGO_LIMITS.maxDimension },
      output: { format: "png" },
    });
    const path = `${shopId}/logo-${randomUUID()}.png`;
    await deps.storage.upload(BUCKETS.brandAssets, path, png.bytes, "image/png");

    const previous = (await deps.repo.businessProfile(shopId)).logoPath;
    await deps.repo.setLogo(shopId, path, "image/png");
    if (previous) await deps.storage.remove(BUCKETS.brandAssets, [previous]).catch(() => undefined);
  } finally {
    await deps.storage.remove(BUCKETS.brandAssets, [uploadPath]).catch(() => undefined);
  }
  return getBusinessProfile(deps, userId);
}

export async function removeLogo(deps: CatalogueDeps, userId: string) {
  const shopId = await shopFor(deps, userId, true);
  const previous = (await deps.repo.businessProfile(shopId)).logoPath;
  await deps.repo.setLogo(shopId, null, null);
  if (previous) await deps.storage.remove(BUCKETS.brandAssets, [previous]).catch(() => undefined);
  return getBusinessProfile(deps, userId);
}

/* ------------------------------------------------------- preview & export */

/** Assemble the render input from saved records only. */
async function buildPdfInput(deps: CatalogueDeps, shopId: string, c: CatalogueRow): Promise<PdfCatalogueInput> {
  const [items, profile] = await Promise.all([deps.repo.items(shopId, c.id), deps.repo.businessProfile(shopId)]);
  const imageBytes = new Map<string, Uint8Array | null>();
  for (const i of items) {
    imageBytes.set(i.id, i.imagePath ? await deps.storage.download(BUCKETS.generated, i.imagePath).catch(() => null) : null);
  }
  const logoBytes = profile.logoPath ? await deps.storage.download(BUCKETS.brandAssets, profile.logoPath).catch(() => null) : null;

  return {
    catalogueName: c.name,
    layout: c.layout,
    orientation: c.orientation,
    includeCover: c.includeCover,
    coverTitle: c.coverTitle,
    coverSubtitle: c.coverSubtitle,
    showPrices: c.showPrices,
    priceNote: c.priceNote,
    includeContactPage: c.includeContactPage,
    business: {
      name: profile.businessName,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      email: profile.email,
      website: profile.website,
      address: profile.address,
    },
    logoBytes,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      description: i.description,
      pricePaise: i.pricePaise,
      specs: i.specs,
      imageBytes: imageBytes.get(i.id) ?? null,
    })),
  };
}

export async function renderCatalogue(deps: CatalogueDeps, userId: string, id: string, quality: RenderQuality) {
  const shopId = await shopFor(deps, userId, false);
  const c = await requireCatalogue(deps, shopId, id);
  const result = await renderCataloguePdf(await buildPdfInput(deps, shopId, c), quality);
  return { ...result, catalogue: c };
}

function safeFileBase(name: string) {
  return name.replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "catalogue";
}

export async function exportCataloguePdf(deps: CatalogueDeps, userId: string, id: string): Promise<CatalogueExportView> {
  const shopId = await shopFor(deps, userId, false);
  const { pdf, pageCount, catalogue } = await renderCatalogue(deps, userId, id, "print");
  const storagePath = `${shopId}/${id}/${randomUUID()}.pdf`;
  await deps.storage.upload(BUCKETS.catalogues, storagePath, new Uint8Array(pdf), "application/pdf");
  const record = await deps.repo.recordExport({
    shopId,
    catalogueId: id,
    kind: "pdf",
    storagePath,
    bytes: pdf.byteLength,
    pageCount,
    catalogueVersion: catalogue.version,
    userId,
  });
  return {
    id: record.id,
    kind: "pdf",
    url: await deps.storage.signedUrl(BUCKETS.catalogues, storagePath, 600, `${safeFileBase(catalogue.name)}.pdf`),
    bytes: pdf.byteLength,
    pageCount,
    createdAt: record.createdAt,
  };
}

/** ZIP of the original approved images (not recompressed), named by position and SKU/name. */
export async function exportCatalogueImages(deps: CatalogueDeps, userId: string, id: string): Promise<CatalogueExportView> {
  const shopId = await shopFor(deps, userId, false);
  const c = await requireCatalogue(deps, shopId, id);
  const items = await deps.repo.items(shopId, id);
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const i of items) {
    if (!i.imagePath) continue;
    const bytes = await deps.storage.download(BUCKETS.generated, i.imagePath).catch(() => null);
    if (!bytes) continue;
    const ext = i.imagePath.split(".").pop() ?? "png";
    const label = safeFileBase(i.sku || i.name || "product");
    let name = `${String(i.position + 1).padStart(2, "0")}-${label}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${String(i.position + 1).padStart(2, "0")}-${label}-${n}.${ext}`;
    used.add(name);
    files[name] = bytes;
  }
  if (Object.keys(files).length === 0) throw new DomainError("invalid_request", "There are no images to download yet.", 400);

  // Images are already compressed; store them without deflate (level 0).
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])));
  const storagePath = `${shopId}/${id}/${randomUUID()}.zip`;
  await deps.storage.upload(BUCKETS.catalogues, storagePath, zip, "application/zip");
  const record = await deps.repo.recordExport({
    shopId,
    catalogueId: id,
    kind: "images_zip",
    storagePath,
    bytes: zip.byteLength,
    pageCount: null,
    catalogueVersion: c.version,
    userId,
  });
  return {
    id: record.id,
    kind: "images_zip",
    url: await deps.storage.signedUrl(BUCKETS.catalogues, storagePath, 600, `${safeFileBase(c.name)}-images.zip`),
    bytes: zip.byteLength,
    pageCount: null,
    createdAt: record.createdAt,
  };
}

/** Signed download link for one product's original image. */
export async function itemImageDownloadUrl(deps: CatalogueDeps, userId: string, id: string, itemId: string) {
  const shopId = await shopFor(deps, userId, false);
  await requireCatalogue(deps, shopId, id);
  const item = (await deps.repo.items(shopId, id)).find((i) => i.id === itemId);
  if (!item?.imagePath) throw domainErrors.notFound("Image");
  const ext = item.imagePath.split(".").pop() ?? "png";
  return deps.storage.signedUrl(BUCKETS.generated, item.imagePath, 120, `${safeFileBase(item.sku || item.name || "product")}.${ext}`);
}

import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { CATALOGUE_LIMITS, itemPatchSchema } from "@/lib/catalogue";
import { CatalogueRepository } from "@/server/catalogue/repository";
import {
  addCatalogueItems,
  completeLogoUpload,
  createCatalogue,
  deleteCatalogue,
  duplicateCatalogue,
  exportCatalogueImages,
  exportCataloguePdf,
  getBusinessProfile,
  getCatalogue,
  listApprovedImages,
  listCatalogues,
  removeCatalogueItem,
  reorderCatalogueItems,
  restoreCatalogue,
  signLogoUpload,
  updateBusinessProfile,
  updateCatalogueItem,
  updateCatalogueSettings,
  type CatalogueDeps,
} from "@/server/catalogue/service";
import { DomainError } from "@/server/generation/domain-error";
import { BUCKETS } from "@/server/generation/ports";
import { MemoryObjectStorage } from "@/server/storage/memory";

import { makePng } from "../support/images";
import { createTestDatabase, createUser, insertGeneratedImage } from "../support/pglite-db";

/**
 * Catalogue service against the real schema (PGlite) and in-memory storage.
 * Every record here is a real database row created through the same SQL the
 * app uses in production.
 */
let pg: PGlite;
let deps: CatalogueDeps;
let storage: MemoryObjectStorage;

beforeAll(async () => {
  const t = await createTestDatabase();
  pg = t.pg;
  storage = new MemoryObjectStorage();
  deps = { repo: new CatalogueRepository(t.db), storage };
}, 60_000);

async function shopWithImages(n: number) {
  const u = await createUser(pg);
  const images = [];
  for (let i = 0; i < n; i++) {
    const img = await insertGeneratedImage(pg, { ...u, fileName: `piece-${i + 1}.jpg` });
    storage.put(BUCKETS.generated, img.storagePath, await makePng(1024, 1024), "image/png");
    images.push(img);
  }
  return { ...u, images };
}

async function domainCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return "ok";
}

describe("catalogue service", () => {
  it("creates, renames, lists and reopens a saved catalogue", async () => {
    const u = await shopWithImages(0);
    const c = await createCatalogue(deps, u.userId, "Diwali 2026");
    expect(c).toMatchObject({ name: "Diwali 2026", layout: "grid", orientation: "portrait", showPrices: false, items: [] });

    const saved = await updateCatalogueSettings(deps, u.userId, c.id, c.version, { name: "Diwali 2026 — Retail", layout: "editorial" });
    expect(saved.version).toBe(c.version + 1);

    const list = await listCatalogues(deps, u.userId);
    expect(list.map((x) => x.name)).toContain("Diwali 2026 — Retail");
    const reopened = await getCatalogue(deps, u.userId, c.id);
    expect(reopened).toMatchObject({ name: "Diwali 2026 — Retail", layout: "editorial" });
  });

  it("rejects a stale version instead of overwriting newer changes", async () => {
    const u = await shopWithImages(0);
    const c = await createCatalogue(deps, u.userId, "Drafts");
    await updateCatalogueSettings(deps, u.userId, c.id, c.version, { coverTitle: "First" });
    expect(await domainCode(updateCatalogueSettings(deps, u.userId, c.id, c.version, { coverTitle: "Stale" }))).toBe("conflict");
    expect((await getCatalogue(deps, u.userId, c.id)).coverTitle).toBe("First");
  });

  it("adds only approved images from the user's own shop, in selection order, without duplicates", async () => {
    const u = await shopWithImages(3);
    const pending = await insertGeneratedImage(pg, { ...u, review: "pending" });
    const discarded = await insertGeneratedImage(pg, { ...u, review: "discarded" });
    const other = await shopWithImages(1);
    const c = await createCatalogue(deps, u.userId, "Mixed");

    const ids = [u.images[2]!.generatedImageId, u.images[0]!.generatedImageId, pending.generatedImageId, discarded.generatedImageId, other.images[0]!.generatedImageId];
    const res = await addCatalogueItems(deps, u.userId, c.id, ids);
    expect(res.added).toBe(2);
    expect(res.rejected).toBe(3);
    expect(res.catalogue.items.map((i) => i.generatedImageId)).toEqual([u.images[2]!.generatedImageId, u.images[0]!.generatedImageId]);
    expect(res.catalogue.items.map((i) => i.position)).toEqual([0, 1]);

    const again = await addCatalogueItems(deps, u.userId, c.id, [u.images[0]!.generatedImageId, u.images[1]!.generatedImageId]);
    expect(again.added).toBe(1);
    expect(again.catalogue.items).toHaveLength(3);
  });

  it("lists only the user's approved images to choose from", async () => {
    const u = await shopWithImages(2);
    await insertGeneratedImage(pg, { ...u, review: "pending" });
    await shopWithImages(2); // another shop
    const images = await listApprovedImages(deps, u.userId);
    expect(images.map((i) => i.generatedImageId).sort()).toEqual(u.images.map((i) => i.generatedImageId).sort());
  });

  it("stores exactly what the user typed and nothing else", async () => {
    const u = await shopWithImages(1);
    const c = await createCatalogue(deps, u.userId, "Fields");
    const { catalogue } = await addCatalogueItems(deps, u.userId, c.id, [u.images[0]!.generatedImageId]);
    const item = catalogue.items[0]!;
    // A freshly added product has no invented details.
    expect(item).toMatchObject({ name: "", sku: "", description: "", pricePaise: null, specs: [] });

    const patch = itemPatchSchema.parse({
      name: "  Padma maang tikka ",
      sku: "MT-1042",
      description: "Floral medallion with pearl drops.",
      pricePaise: 1_234_500,
      specs: [{ label: "Weight", value: "18.4 g" }, { label: "", value: "" }],
    });
    await updateCatalogueItem(deps, u.userId, c.id, item.id, patch);
    const saved = (await getCatalogue(deps, u.userId, c.id)).items[0]!;
    expect(saved).toMatchObject({
      name: "Padma maang tikka",
      sku: "MT-1042",
      description: "Floral medallion with pearl drops.",
      pricePaise: 1_234_500,
      specs: [{ label: "Weight", value: "18.4 g" }],
    });

    await updateCatalogueItem(deps, u.userId, c.id, item.id, { pricePaise: null });
    expect((await getCatalogue(deps, u.userId, c.id)).items[0]!.pricePaise).toBeNull();
  });

  it("validates item fields", () => {
    expect(itemPatchSchema.safeParse({ description: "x".repeat(CATALOGUE_LIMITS.descriptionMax + 1) }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ pricePaise: -1 }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ pricePaise: 12.5 }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ specs: Array.from({ length: 13 }, () => ({ label: "a", value: "b" })) }).success).toBe(false);
  });

  it("reorders and removes products, keeping positions contiguous", async () => {
    const u = await shopWithImages(4);
    const c = await createCatalogue(deps, u.userId, "Order");
    const { catalogue } = await addCatalogueItems(deps, u.userId, c.id, u.images.map((i) => i.generatedImageId));
    const ids = catalogue.items.map((i) => i.id);

    await reorderCatalogueItems(deps, u.userId, c.id, [ids[3]!, ids[1]!, ids[0]!, ids[2]!]);
    expect((await getCatalogue(deps, u.userId, c.id)).items.map((i) => i.id)).toEqual([ids[3], ids[1], ids[0], ids[2]]);

    expect(await domainCode(reorderCatalogueItems(deps, u.userId, c.id, [ids[0]!, ids[1]!]))).toBe("conflict");
    expect(await domainCode(reorderCatalogueItems(deps, u.userId, c.id, [ids[0]!, ids[0]!, ids[1]!, ids[2]!]))).toBe("conflict");

    await removeCatalogueItem(deps, u.userId, c.id, ids[1]!);
    const after = await getCatalogue(deps, u.userId, c.id);
    expect(after.items.map((i) => i.id)).toEqual([ids[3], ids[0], ids[2]]);
    expect(after.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("duplicates a catalogue with all products and settings", async () => {
    const u = await shopWithImages(2);
    const c = await createCatalogue(deps, u.userId, "Original");
    await updateCatalogueSettings(deps, u.userId, c.id, c.version, { orientation: "landscape", showPrices: true });
    const { catalogue } = await addCatalogueItems(deps, u.userId, c.id, u.images.map((i) => i.generatedImageId));
    await updateCatalogueItem(deps, u.userId, c.id, catalogue.items[0]!.id, { name: "First" });

    const copy = await duplicateCatalogue(deps, u.userId, c.id);
    expect(copy.id).not.toBe(c.id);
    expect(copy).toMatchObject({ name: "Copy of Original", orientation: "landscape", showPrices: true });
    expect(copy.items.map((i) => i.name)).toEqual(["First", ""]);
    // Editing the copy leaves the original alone.
    await updateCatalogueItem(deps, u.userId, copy.id, copy.items[0]!.id, { name: "Changed" });
    expect((await getCatalogue(deps, u.userId, c.id)).items[0]!.name).toBe("First");
  });

  it("deletes into a restorable state", async () => {
    const u = await shopWithImages(1);
    const c = await createCatalogue(deps, u.userId, "Old season");
    await deleteCatalogue(deps, u.userId, c.id);
    expect((await listCatalogues(deps, u.userId)).map((x) => x.id)).not.toContain(c.id);
    expect((await listCatalogues(deps, u.userId, true)).map((x) => x.id)).toContain(c.id);
    expect(await domainCode(getCatalogue(deps, u.userId, c.id))).toBe("not_found");

    const restored = await restoreCatalogue(deps, u.userId, c.id);
    expect(restored.name).toBe("Old season");
  });

  it("hides every catalogue and product from other shops", async () => {
    const owner = await shopWithImages(1);
    const intruder = await shopWithImages(1);
    const c = await createCatalogue(deps, owner.userId, "Private");
    const { catalogue } = await addCatalogueItems(deps, owner.userId, c.id, [owner.images[0]!.generatedImageId]);
    const itemId = catalogue.items[0]!.id;

    const attempts: Promise<unknown>[] = [
      getCatalogue(deps, intruder.userId, c.id),
      updateCatalogueSettings(deps, intruder.userId, c.id, 1, { name: "hacked" }),
      duplicateCatalogue(deps, intruder.userId, c.id),
      deleteCatalogue(deps, intruder.userId, c.id),
      addCatalogueItems(deps, intruder.userId, c.id, [intruder.images[0]!.generatedImageId]),
      updateCatalogueItem(deps, intruder.userId, c.id, itemId, { name: "hacked" }),
      removeCatalogueItem(deps, intruder.userId, c.id, itemId),
      reorderCatalogueItems(deps, intruder.userId, c.id, [itemId]),
      exportCataloguePdf(deps, intruder.userId, c.id),
      exportCatalogueImages(deps, intruder.userId, c.id),
    ];
    for (const a of attempts) expect(await domainCode(a)).toBe("not_found");
    expect((await listCatalogues(deps, intruder.userId)).map((x) => x.id)).not.toContain(c.id);
    expect((await getCatalogue(deps, owner.userId, c.id)).items[0]!.name).toBe("");
  });

  it("lets viewers read but not change catalogues", async () => {
    const owner = await shopWithImages(0);
    const c = await createCatalogue(deps, owner.userId, "Team");
    const viewer = randomUUID();
    await pg.query("insert into auth.users (id) values ($1)", [viewer]);
    await pg.query("delete from public.shop_members where user_id = $1", [viewer]);
    await pg.query("insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'viewer')", [owner.shopId, viewer]);
    expect((await getCatalogue(deps, viewer, c.id)).name).toBe("Team");
    expect(await domainCode(updateCatalogueSettings(deps, viewer, c.id, c.version, { name: "x" }))).toBe("forbidden");
  });

  it("keeps working when an image is deleted: the product shows as missing", async () => {
    const u = await shopWithImages(2);
    const c = await createCatalogue(deps, u.userId, "Missing");
    await addCatalogueItems(deps, u.userId, c.id, u.images.map((i) => i.generatedImageId));
    await pg.query("delete from public.generated_images where id = $1", [u.images[0]!.generatedImageId]);
    const view = await getCatalogue(deps, u.userId, c.id);
    expect(view.items[0]!.generatedImageId).toBeNull();
    expect(view.warnings.join(" ")).toMatch(/1 product has no image/);
    const exported = await exportCataloguePdf(deps, u.userId, c.id);
    expect(exported.pageCount).toBeGreaterThan(0);
  });

  it("saves business details and a validated logo", async () => {
    const u = await shopWithImages(0);
    const profile = await updateBusinessProfile(deps, u.userId, { businessName: "Sharma Jewellers", phone: "+91 98100 00000", email: "" });
    expect(profile).toMatchObject({ businessName: "Sharma Jewellers", phone: "+91 98100 00000", logoUrl: null });

    const signed = await signLogoUpload(deps, u.userId, { mimeType: "image/png", sizeBytes: 5000 });
    storage.put(BUCKETS.brandAssets, signed.path, await makePng(400, 200, true), "image/png");
    const withLogo = await completeLogoUpload(deps, u.userId, signed.path);
    expect(withLogo.logoUrl).toContain("brand-assets/");
    expect(storage.get(BUCKETS.brandAssets, signed.path)).toBeNull(); // raw upload removed

    // A path belonging to another shop is refused.
    const other = await shopWithImages(0);
    expect(await domainCode(completeLogoUpload(deps, other.userId, signed.path))).toBe("forbidden");

    // A non-image is rejected.
    const bad = await signLogoUpload(deps, u.userId, { mimeType: "image/png", sizeBytes: 20 });
    storage.put(BUCKETS.brandAssets, bad.path, new TextEncoder().encode("not a logo"), "image/png");
    expect(await domainCode(completeLogoUpload(deps, u.userId, bad.path))).toBe("invalid_file");
    expect((await getBusinessProfile(deps, u.userId)).logoUrl).toContain("brand-assets/");
  });

  it("exports a PDF and an images ZIP to private storage and records them", async () => {
    const u = await shopWithImages(3);
    const c = await createCatalogue(deps, u.userId, "Export test");
    const { catalogue } = await addCatalogueItems(deps, u.userId, c.id, u.images.map((i) => i.generatedImageId));
    await updateCatalogueItem(deps, u.userId, c.id, catalogue.items[0]!.id, { sku: "SKU-1" });

    const pdf = await exportCataloguePdf(deps, u.userId, c.id);
    expect(pdf.kind).toBe("pdf");
    expect(pdf.pageCount).toBe(2); // cover + one grid page (no contact details yet)
    expect(pdf.url).toMatch(/^memory:\/\/catalogues\/.+\.pdf\?ttl=600&download=Export-test\.pdf$/);

    const zip = await exportCatalogueImages(deps, u.userId, c.id);
    expect(zip.kind).toBe("images_zip");
    const { unzipSync } = await import("fflate");
    const zipPath = decodeURIComponent(zip.url.replace("memory://catalogues/", "").split("?")[0]!);
    const entries = Object.keys(unzipSync(storage.get(BUCKETS.catalogues, zipPath)!.bytes));
    expect(entries).toEqual(["01-SKU-1.png", "02-product.png", "03-product.png"]);

    const { rows } = await pg.query<{ kind: string }>("select kind from public.catalogue_exports where catalogue_id = $1 order by created_at", [c.id]);
    expect(rows.map((r) => r.kind)).toEqual(["pdf", "images_zip"]);
  });
});

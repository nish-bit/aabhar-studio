/**
 * Builds a 10-product catalogue through the real catalogue service and SQL
 * (embedded Postgres with the project's migrations), then exports:
 *   - a print PDF (A4 portrait, grid)
 *   - a duplicated catalogue as A4 landscape, editorial
 *   - a ZIP of the individual images
 *
 *   npx tsx scripts/catalogue-demo.ts [output-dir]
 *
 * TEST DATA: the business details and product text below are placeholders
 * for verifying layout, marked "(test data)". They describe only what is
 * visible in each photo — no prices, materials, weights, grades or
 * certifications. The images are the sample photos in public/demo standing
 * in for approved Studio results.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { CatalogueRepository } from "@/server/catalogue/repository";
import {
  addCatalogueItems,
  completeLogoUpload,
  createCatalogue,
  duplicateCatalogue,
  exportCatalogueImages,
  exportCataloguePdf,
  getCatalogue,
  signLogoUpload,
  updateBusinessProfile,
  updateCatalogueItem,
  updateCatalogueSettings,
} from "@/server/catalogue/service";
import { BUCKETS } from "@/server/generation/ports";
import { MemoryObjectStorage } from "@/server/storage/memory";

import { createTestDatabase, createUser, insertGeneratedImage } from "../tests/support/pglite-db";

const outDir = path.resolve(process.argv[2] ?? "tmp-output/catalogue-demo");

const PRODUCTS: { file: string; name: string; sku: string; description: string }[] = [
  { file: "tikka-studio.webp", name: "Floral medallion maang tikka", sku: "DEMO-001", description: "Round floral medallion with a row of pearl drops along the lower edge, on a short linked chain." },
  { file: "ring-diamond-dark.webp", name: "Open-work cluster ring", sku: "DEMO-002", description: "Circular open-work head with a central stone cluster and radiating set stones." },
  {
    file: "necklace-silver-display.webp",
    name: "Ghungroo bell necklace",
    sku: "DEMO-003",
    description:
      "Flat curb chain with two rows of hanging bell charms and small square enamel accents spaced along the front. " +
      "This longer description is test data to show how the grid layout shortens text that doesn't fit, and how the editorial layout prints it in full. " +
      "In a real catalogue, write only details you can confirm from your own records, such as dimensions you have measured or materials you have certified. " +
      "The catalogue builder never adds prices, materials, weights, gemstone grades or certifications on its own; everything printed comes from what you type here.",
  },
  { file: "necklace-pearl-flower.webp", name: "Pearl petal flower pendant", sku: "DEMO-004", description: "Five baroque pearl petals around a faceted centre stone, with small green stones on wire stamens." },
  { file: "ring-box.webp", name: "Twist band solitaire ring", sku: "DEMO-005", description: "Single round stone on a crossover band with set stones along one side, shown in a presentation box." },
  { file: "earrings-model.webp", name: "Chandbali drop earrings", sku: "DEMO-006", description: "Crescent drop with a row of red and white stones and a single bead hanging below." },
  { file: "bangles-model.webp", name: "Pair of temple bangles", sku: "DEMO-007", description: "Two bangles with raised floral work and three red cabochon stones at the front." },
  { file: "bracelet-model.webp", name: "Textured link bracelet", sku: "DEMO-008", description: "Alternating plain, ribbed and dotted links with an S-hook clasp." },
  { file: "anklets-satin.webp", name: "Payal anklets (pair)", sku: "DEMO-009", description: "Chevron-pattern band with hanging bell charms, shown as a pair." },
  { file: "ring-infinity-model.webp", name: "इन्फिनिटी अंगूठी — infinity ring", sku: "DEMO-010", description: "Infinity-shaped band set with small stones." },
];

async function main() {
  const started = Date.now();
  const { pg, db } = await createTestDatabase();
  const storage = new MemoryObjectStorage();
  const deps = { repo: new CatalogueRepository(db), storage };
  const user = await createUser(pg);

  // Business details (test data) and a plain placeholder wordmark logo.
  await updateBusinessProfile(deps, user.userId, {
    businessName: "Sample Jewellers (test data)",
    phone: "+91 00000 00000",
    email: "hello@example.com",
    website: "example.com",
    address: "Test address, New Delhi",
  });
  const logo = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><rect width="480" height="160" fill="none"/>
       <path d="M40 30 80 80 40 130 0 80z" transform="translate(20 0)" fill="none" stroke="#b08a4a" stroke-width="6"/>
       <text x="130" y="100" font-family="Georgia, serif" font-size="56" fill="#1c1a17">Sample</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const logoUpload = await signLogoUpload(deps, user.userId, { mimeType: "image/png", sizeBytes: logo.byteLength });
  storage.put(BUCKETS.brandAssets, logoUpload.path, new Uint8Array(logo), "image/png");
  await completeLogoUpload(deps, user.userId, logoUpload.path);

  // Ten approved images (sample photos standing in for approved Studio results).
  const imageIds: string[] = [];
  for (const p of PRODUCTS) {
    const img = await insertGeneratedImage(pg, { ...user, fileName: p.file, ext: "png" });
    const png = await sharp(await readFile(path.resolve("public/demo", p.file))).png().toBuffer();
    storage.put(BUCKETS.generated, img.storagePath, new Uint8Array(png), "image/png");
    imageIds.push(img.generatedImageId);
  }

  // Build the catalogue.
  const created = await createCatalogue(deps, user.userId, "Festive Collection — sample");
  await updateCatalogueSettings(deps, user.userId, created.id, created.version, {
    coverTitle: "Festive Collection",
    coverSubtitle: "Sample catalogue built from test data to verify layout, page breaks and text wrapping.",
  });
  const { catalogue } = await addCatalogueItems(deps, user.userId, created.id, imageIds);
  for (const [i, item] of catalogue.items.entries()) {
    const p = PRODUCTS[i]!;
    await updateCatalogueItem(deps, user.userId, created.id, item.id, {
      name: p.name,
      sku: p.sku,
      description: p.description,
      specs: i === 1 ? [{ label: "Display tray", value: "A1 (test data)" }] : [],
    });
  }
  // Simulate one image being deleted later, to show the placeholder.
  await pg.query("delete from public.generated_images where id = $1", [imageIds[7]]);

  const saved = await getCatalogue(deps, user.userId, created.id);
  console.log(`✓ Catalogue "${saved.name}" saved with ${saved.items.length} products (v${saved.version})`);
  if (saved.warnings.length) console.log(`  Warnings shown to the user:\n  - ${saved.warnings.join("\n  - ")}`);

  await mkdir(outDir, { recursive: true });
  const read = (url: string) => {
    const [bucket, ...rest] = url.replace("memory://", "").split("?")[0]!.split("/");
    return storage.get(bucket!, decodeURIComponent(rest.join("/")))!.bytes;
  };

  const grid = await exportCataloguePdf(deps, user.userId, created.id);
  await writeFile(path.join(outDir, "catalogue-a4-portrait-grid.pdf"), read(grid.url));
  console.log(`✓ Print PDF (A4 portrait, grid): ${grid.pageCount} pages, ${(grid.bytes / 1024 / 1024).toFixed(2)} MB`);

  const copy = await duplicateCatalogue(deps, user.userId, created.id);
  await updateCatalogueSettings(deps, user.userId, copy.id, copy.version, { layout: "editorial", orientation: "landscape", name: "Festive Collection — editorial (sample)" });
  const editorial = await exportCataloguePdf(deps, user.userId, copy.id);
  await writeFile(path.join(outDir, "catalogue-a4-landscape-editorial.pdf"), read(editorial.url));
  console.log(`✓ Print PDF (A4 landscape, editorial): ${editorial.pageCount} pages, ${(editorial.bytes / 1024 / 1024).toFixed(2)} MB`);

  const zip = await exportCatalogueImages(deps, user.userId, created.id);
  await writeFile(path.join(outDir, "catalogue-images.zip"), read(zip.url));
  console.log(`✓ Images ZIP: ${(zip.bytes / 1024 / 1024).toFixed(2)} MB`);

  const counts = await pg.query<{ catalogues: number; items: number; exports: number }>(
    `select (select count(*)::int from public.catalogues) as catalogues,
            (select count(*)::int from public.catalogue_items) as items,
            (select count(*)::int from public.catalogue_exports) as exports`,
  );
  console.log(`  Database rows: ${JSON.stringify(counts.rows[0])}`);
  console.log(`  Output: ${outDir}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

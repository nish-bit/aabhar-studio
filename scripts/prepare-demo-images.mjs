#!/usr/bin/env node
/**
 * Prepares DEMO marketing imagery from source photos.
 *
 * Usage:  node scripts/prepare-demo-images.mjs <source-dir>
 *
 * - Resizes and converts each listed photo to WebP in public/demo/.
 * - For the two "before/after" demo pairs it also writes a SIMULATED
 *   "before" image by degrading the studio photo (dim, warm cast, soft,
 *   off-centre crop, grain). These are NOT outputs of any AI model and
 *   the UI labels them as simulated. Replace them with real customer
 *   before/after pairs before launch.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error("Usage: node scripts/prepare-demo-images.mjs <source-dir>");
  process.exit(1);
}

const outDir = path.resolve("public/demo");
await mkdir(outDir, { recursive: true });

/** source file -> output slug, max width */
const images = [
  ["preview_4.jpg", "tikka-studio", 1600],
  ["preview_3.jpg", "ring-diamond-dark", 1600],
  ["preview_2.jpg", "necklace-silver-display", 1400],
  ["preview_1.jpg", "bridal-bracelet", 1400],
  ["preview_6.jpg", "bangles-model", 1400],
  ["preview_7.jpg", "anklets-satin", 1600],
  ["preview_11.jpg", "earrings-model", 1400],
  ["preview_12.jpg", "bracelet-model", 1400],
  ["preview_5.jpg", "ring-infinity-model", 1400],
  ["hosniye-sadeghi-rvF5EglUXWg-unsplash.jpg", "necklace-pearl-flower", 1600],
  ["jackie-tsang-3_YP8_mh-Kg-unsplash.jpg", "ring-box", 1600],
  ["segal-jewelry-NsH-CvU0deg-unsplash.jpg", "layered-gold", 1600],
];

for (const [file, slug, width] of images) {
  const input = path.join(sourceDir, file);
  await sharp(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(outDir, `${slug}.webp`));
  console.log(`✓ ${slug}.webp`);
}

/** Simulated "phone photo" versions for demo before/after pairs only. */
async function simulateBefore(slug) {
  const src = path.join(outDir, `${slug}.webp`);
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 1400;
  const h = meta.height ?? 1400;

  // fine grain layer
  const grain = await sharp({
    create: { width: w, height: h, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 22 } },
  })
    .png()
    .toBuffer();

  // dull, uneven "room light" overlay — keeps metal hue intact (we never
  // want a demo to imply a change of metal colour)
  const shade = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 120, g: 104, b: 84, alpha: 0.28 } },
  })
    .png()
    .toBuffer();

  await sharp(src)
    .modulate({ brightness: 0.86, saturation: 0.92 })
    .linear(0.78, 18) // flatten contrast
    .blur(1.3)
    .composite([
      { input: shade, blend: "multiply" },
      { input: grain, blend: "soft-light" },
    ])
    .extract({
      left: Math.round(w * 0.04),
      top: Math.round(h * 0.07),
      width: Math.round(w * 0.92),
      height: Math.round(h * 0.92),
    })
    .resize({ width: w, height: h, fit: "cover" })
    .rotate(-2.5, { background: "#6b5a46" })
    .resize({ width: w, height: h, fit: "cover" })
    .webp({ quality: 70 })
    .toFile(path.join(outDir, `${slug}-simulated-before.webp`));
  console.log(`✓ ${slug}-simulated-before.webp (simulated, demo only)`);
}

await simulateBefore("tikka-studio");
await simulateBefore("ring-diamond-dark");

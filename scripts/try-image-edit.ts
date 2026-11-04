/**
 * Try the real image provider on ONE local photo, without Supabase.
 * Uses exactly the same validation, sanitising, prompt and adapter code as
 * the app, and writes the provider's real output next to a copy of your
 * original so you can compare them.
 *
 *   OPENAI_API_KEY=sk-... npx tsx scripts/try-image-edit.ts ./ring.jpg white-studio "slightly warmer light"
 *
 * This makes one real, billed API call per run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isPresetSlug, PRESET_SLUGS } from "@/lib/presets";
import { buildEditPrompt } from "@/server/generation/prompts";
import { outputSizeFor, sanitizeImage, validateImageBytes } from "@/server/imaging/validate";
import { ProviderError } from "@/server/providers/image/errors";
import { OpenAIImageProvider } from "@/server/providers/image/openai";

async function main() {
  const [file, presetArg = "white-studio", notes = ""] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: npx tsx scripts/try-image-edit.ts <photo.jpg> [preset] [notes]");
    console.error(`Presets: ${PRESET_SLUGS.join(", ")}`);
    process.exit(1);
  }
  if (!isPresetSlug(presetArg)) throw new Error(`Unknown preset "${presetArg}". Use one of: ${PRESET_SLUGS.join(", ")}`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY in your shell first.");
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst";

  const raw = new Uint8Array(await readFile(file));
  const ext = path.extname(file).toLowerCase();
  const declared = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const checked = await validateImageBytes(raw, declared);
  const clean = await sanitizeImage(raw);
  console.log(`✓ Photo OK: ${checked.width}×${checked.height}, sanitised to ${clean.mimeType}`);

  const provider = new OpenAIImageProvider({
    apiKey,
    model,
    quality: (process.env.OPENAI_IMAGE_QUALITY as "high") ?? "high",
    timeoutMs: 180_000,
  });
  const size = outputSizeFor(clean.width, clean.height);
  console.log(`… Calling ${model} (${presetArg}, ${size}). This can take a minute or two.`);

  const result = await provider.editImage({
    image: { bytes: clean.bytes, mimeType: clean.mimeType, fileName: `source.${clean.mimeType === "image/png" ? "png" : "jpg"}` },
    prompt: buildEditPrompt(presetArg, notes || null),
    size,
    safetyIdentifier: "local-test",
  });

  const outDir = path.resolve("tmp-output");
  await mkdir(outDir, { recursive: true });
  const base = path.basename(file, ext);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const originalPath = path.join(outDir, `${base}_${stamp}_original.${clean.mimeType === "image/png" ? "png" : "jpg"}`);
  const editedPath = path.join(outDir, `${base}_${stamp}_${presetArg}.png`);
  await writeFile(originalPath, clean.bytes);
  await writeFile(editedPath, result.image);

  console.log(`✓ Done in ${(result.latencyMs / 1000).toFixed(1)} s · request ${result.providerRequestId ?? "n/a"}`);
  console.log(
    result.usage
      ? `  Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out · estimated cost $${((result.costUsdMicros ?? 0) / 1e6).toFixed(4)}`
      : "  The provider didn't report usage; cost unknown.",
  );
  console.log(`  Original: ${originalPath}\n  Edited:   ${editedPath}`);
  console.log("  Now compare stone count and colour, metal colour, engravings, proportions and setting.");
}

main().catch((err) => {
  if (err instanceof ProviderError) {
    console.error(`✗ Provider error (${err.category}${err.status ? `, HTTP ${err.status}` : ""}): ${err.message}`);
  } else {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});

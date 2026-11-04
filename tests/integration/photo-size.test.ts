import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PHOTO_SIZES, cropBoxFor, type PhotoSizeId } from "@/lib/photo-sizes";
import { buildEditPrompt } from "@/server/generation/prompts";
import { BUCKETS } from "@/server/generation/ports";
import { runGenerationJob, submitGeneration, type GenerationDeps } from "@/server/generation/service";
import { OpenAIImageProvider } from "@/server/providers/image/openai";

import { FakeRepository, FakeStorage } from "../support/fakes";
import { makeJpeg } from "../support/images";
import { mockOpenAIFetch } from "../support/openai-mock";

/**
 * Photo size (step 4) and jewellery type (step 1) reach the real OpenAI
 * adapter: the right frame is requested, the prompt carries the type and a
 * safe-margin framing line, and the stored image has the exact ratio.
 */
async function setup(logs: { event: string; data: unknown }[] = []) {
  const repo = new FakeRepository();
  const storage = new FakeStorage();
  const mock = mockOpenAIFetch([{ kind: "ok", frame: true }, { kind: "ok", frame: true }]);
  const provider = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-2.5-sunburst", quality: "high", timeoutMs: 5_000, fetchImpl: mock.fetchImpl });
  const deps: GenerationDeps = {
    repo,
    storage,
    provider,
    limits: { maxActiveJobs: 3, dailyLimit: 200 },
    sleep: async () => undefined,
    log: (event, data) => void logs.push({ event, data }),
  };
  const userId = randomUUID();
  const shopId = repo.addShop(userId, 10);
  const sourceId = repo.addReadySource(shopId, userId);
  storage.put(BUCKETS.originals, repo.sources.get(sourceId)!.storagePath!, await makeJpeg());
  return { repo, storage, deps, userId, shopId, sourceId, mock };
}

const key = () => randomUUID().replace(/-/g, "");
const sent = (mock: { calls: { init: RequestInit }[] }, field: string) => String((mock.calls.at(-1)!.init.body as FormData).get(field));

async function storedSize(storage: FakeStorage, shopId: string, jobId: string) {
  const stored = storage.objects.get(`${BUCKETS.generated}/${shopId}/${jobId}/result.png`)!;
  const m = await sharp(stored.bytes).metadata();
  return { width: m.width, height: m.height };
}

describe("photo size", () => {
  it.each(PHOTO_SIZES.map((s) => [s.id, s] as const))("%s: requests the nearest frame and stores the exact ratio", async (_id, size) => {
    const { deps, repo, storage, userId, shopId, sourceId, mock } = await setup();
    const { jobId } = await submitGeneration(deps, userId, {
      sourceImageId: sourceId,
      presetSlug: "white-studio",
      idempotencyKey: key(),
      photoSize: size.id,
      jewelleryType: "necklace",
    });
    expect(await repo.getJobOptions(jobId)).toEqual({ photoSize: size.id, jewelleryType: "necklace" });

    await runGenerationJob(deps, jobId);
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(sent(mock, "size")).toBe(size.frame);
    expect(sent(mock, "prompt")).toContain("The piece is: Necklace (solo necklace).");
    expect(await storedSize(storage, shopId, jobId)).toEqual(size.output);
    const g = [...repo.generated.values()].find((x) => x.jobId === jobId)!;
    expect({ width: g.width, height: g.height }).toEqual(size.output);
  });

  it("without a photo size keeps the original behaviour: frame from the photo's shape, no framing or type lines", async () => {
    const { deps, storage, userId, shopId, sourceId, mock } = await setup();
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    expect(sent(mock, "size")).toBe("1024x1024"); // the test photo is square
    expect(sent(mock, "prompt")).not.toMatch(/Framing:|The piece is:/);
    expect(await storedSize(storage, shopId, jobId)).toEqual({ width: 1024, height: 1024 });
  });

  it("a replayed request keeps the original options and charges once", async () => {
    const { deps, repo, userId, shopId, sourceId } = await setup();
    const k = key();
    const a = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: k, photoSize: "3:4" });
    const b = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: k, photoSize: "16:9" });
    expect(b.jobId).toBe(a.jobId);
    expect((await repo.getJobOptions(a.jobId)).photoSize).toBe("3:4");
    expect(repo.balances.get(shopId)).toBe(9);
  });

  it("if the options can't be saved (migration not applied), the job is still created and runs with default framing", async () => {
    const logs: { event: string; data: unknown }[] = [];
    const { deps, repo, userId, sourceId, mock } = await setup(logs);
    repo.setJobOptions = async () => {
      throw new Error('column "photo_size" does not exist');
    };
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key(), photoSize: "9:16" });
    expect(logs.map((l) => l.event)).toContain("generation.options_not_saved");
    await runGenerationJob(deps, jobId);
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(sent(mock, "size")).toBe("1024x1024");
  });
});

describe("photo size definitions", () => {
  it("map Catalogue/Instagram/Lookbook/Story to 3:4, 1:1, 16:9 and 9:16 with distinct shapes", () => {
    expect(PHOTO_SIZES.map((s) => [s.name, s.id])).toEqual([
      ["Catalogue", "3:4"],
      ["Instagram", "1:1"],
      ["Lookbook", "16:9"],
      ["Story", "9:16"],
    ]);
    expect(new Set(PHOTO_SIZES.map((s) => (s.w / s.h).toFixed(3))).size).toBe(4);
  });

  it("each output is the exact ratio, cropped from its model frame", () => {
    for (const s of PHOTO_SIZES) {
      const [fw, fh] = s.frame.split("x").map(Number) as [number, number];
      const box = cropBoxFor(s, fw, fh);
      expect({ width: box.width, height: box.height }, s.id).toEqual(s.output);
      expect(Math.abs(box.width / box.height - s.w / s.h)).toBeLessThan(0.002);
    }
  });

  it("asks the model for a safe margin only when the frame will be trimmed", () => {
    const framing = (id: PhotoSizeId) => buildEditPrompt("white-studio", null, { photoSize: id }).match(/Framing: .*/)?.[0] ?? null;
    expect(framing("1:1")).toBeNull();
    expect(framing("3:4")).toMatch(/3:4 portrait frame.*middle 79% of the image's height/);
    expect(framing("16:9")).toMatch(/16:9 landscape frame.*middle 75% of the image's height/);
    expect(framing("9:16")).toMatch(/9:16 vertical frame.*middle 75% of the image's width/);
    // The fidelity rules still come first.
    const p = buildEditPrompt("white-studio", null, { photoSize: "3:4", jewelleryType: "ring" });
    expect(p.indexOf("Keep the jewellery exactly")).toBeLessThan(p.indexOf("Framing:"));
  });
});

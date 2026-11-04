import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/generation/domain-error";
import { BUCKETS } from "@/server/generation/ports";
import {
  completeUpload,
  downloadUrl,
  getGenerationView,
  reviewGeneration,
  runGenerationJob,
  signUpload,
  submitGeneration,
  type GenerationDeps,
} from "@/server/generation/service";
import { OpenAIImageProvider } from "@/server/providers/image/openai";

import { FakeRepository, FakeStorage } from "../support/fakes";
import { makeJpeg } from "../support/images";
import { mockOpenAIFetch, type MockReply } from "../support/openai-mock";

/**
 * End-to-end service flow with the real OpenAI adapter talking to a mocked
 * HTTP endpoint, and in-memory database/storage fakes.
 */
async function setup(replies: MockReply[], credits = 10) {
  const repo = new FakeRepository();
  const storage = new FakeStorage();
  const mock = mockOpenAIFetch(replies);
  const provider = new OpenAIImageProvider({
    apiKey: "sk-test",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    timeoutMs: 5_000,
    fetchImpl: mock.fetchImpl,
  });
  const sleeps: number[] = [];
  const deps: GenerationDeps = {
    repo,
    storage,
    provider,
    limits: { maxActiveJobs: 3, dailyLimit: 200 },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  const userId = randomUUID();
  const shopId = repo.addShop(userId, credits);
  const sourceId = repo.addReadySource(shopId, userId);
  const source = repo.sources.get(sourceId)!;
  storage.put(BUCKETS.originals, source.storagePath!, await makeJpeg());
  return { repo, storage, deps, userId, shopId, sourceId, mock, sleeps };
}

const key = () => randomUUID().replace(/-/g, "");

async function expectDomainError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

describe("generation flow", () => {
  it("uploads, validates, sanitises and marks a photo ready", async () => {
    const { deps, userId, storage, repo } = await setup([]);
    const signed = await signUpload(deps, userId, { fileName: "ring.jpg", mimeType: "image/jpeg", sizeBytes: 50_000 });
    storage.put(BUCKETS.originals, signed.path, await makeJpeg(1600, 1600, true));

    const view = await completeUpload(deps, userId, signed.sourceImageId);
    expect(view).toMatchObject({ width: 1600, height: 1600 });
    expect(repo.sources.get(signed.sourceImageId)!.status).toBe("ready");
    // The raw upload (with EXIF) is deleted; only the sanitised copy remains.
    expect(storage.objects.has(`originals/${signed.path}`)).toBe(false);
  });

  it("accepts a small 500×666 photo (no minimum resolution) and can generate from it", async () => {
    const { deps, userId, storage, repo, mock } = await setup([{ kind: "ok" }]);
    const signed = await signUpload(deps, userId, { fileName: "small.jpg", mimeType: "image/jpeg", sizeBytes: 30_000 });
    storage.put(BUCKETS.originals, signed.path, await makeJpeg(500, 666));

    const view = await completeUpload(deps, userId, signed.sourceImageId);
    expect(view).toMatchObject({ width: 500, height: 666 });
    expect(repo.sources.get(signed.sourceImageId)!.status).toBe("ready");

    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: signed.sourceImageId, presetSlug: "white-studio", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(mock.calls).toHaveLength(1);
  });

  it("rejects a fake image and removes it", async () => {
    const { deps, userId, storage, repo } = await setup([]);
    const signed = await signUpload(deps, userId, { fileName: "ring.jpg", mimeType: "image/jpeg", sizeBytes: 20 });
    storage.put(BUCKETS.originals, signed.path, new TextEncoder().encode("definitely not an image"));
    await expectDomainError(completeUpload(deps, userId, signed.sourceImageId), "invalid_file");
    expect(repo.sources.get(signed.sourceImageId)!.status).toBe("rejected");
    expect(storage.objects.has(`originals/${signed.path}`)).toBe(false);
  });

  it("generates, stores privately, records cost, and charges exactly once", async () => {
    const { deps, userId, shopId, sourceId, repo, storage } = await setup([{ kind: "ok" }]);

    const { jobId, balance } = await submitGeneration(deps, userId, {
      sourceImageId: sourceId,
      presetSlug: "velvet",
      instructions: "warmer light",
      idempotencyKey: key(),
    });
    expect(balance).toBe(8); // velvet costs 2

    await runGenerationJob(deps, jobId);

    const job = repo.jobs.get(jobId)!;
    expect(job.status).toBe("succeeded");
    expect(job.costUsdMicros).toBe(129_750);
    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0]).toMatchObject({ outcome: "succeeded", providerRequestId: "req_test_123" });
    expect(storage.objects.has(`generated/${shopId}/${jobId}/result.png`)).toBe(true);
    expect(repo.balances.get(shopId)).toBe(8);
    expect(repo.ledgerSum(shopId)).toBe(8);

    const view = await getGenerationView(deps, userId, jobId);
    expect(view.status).toBe("succeeded");
    expect(view.result?.url).toContain("generated/");
    expect(view.result?.reviewStatus).toBe("pending");
  });

  it("does not charge twice for a repeated Idempotency-Key", async () => {
    const { deps, userId, shopId, sourceId, repo } = await setup([{ kind: "ok" }]);
    const k = key();
    const a = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: k });
    const b = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: k });
    expect(b.jobId).toBe(a.jobId);
    expect(b.replayed).toBe(true);
    expect(repo.jobs.size).toBe(1);
    expect(repo.balances.get(shopId)).toBe(9);
    expect(repo.ledger.filter((l) => l.type === "debit")).toHaveLength(1);
  });

  it("runs a job only once even if triggered twice", async () => {
    const { deps, userId, sourceId, repo, mock } = await setup([{ kind: "ok" }, { kind: "ok" }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "marble", idempotencyKey: key() });
    await Promise.all([runGenerationJob(deps, jobId), runGenerationJob(deps, jobId)]);
    expect(mock.calls).toHaveLength(1);
    expect(repo.generated.size).toBe(1);
  });

  it("retries a transient provider error once, then succeeds with a single charge", async () => {
    const { deps, userId, shopId, sourceId, repo, sleeps } = await setup([{ kind: "error", status: 503 }, { kind: "ok" }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "warm-ivory", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(repo.attempts.map((a) => a.outcome)).toEqual(["retryable_error", "succeeded"]);
    expect(sleeps).toEqual([3_000]);
    expect(repo.balances.get(shopId)).toBe(9);
  });

  it("honours Retry-After on rate limits (capped)", async () => {
    const { deps, userId, sourceId, sleeps } = await setup([
      { kind: "error", status: 429, headers: { "retry-after": "60" } },
      { kind: "ok" },
    ]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    expect(sleeps).toEqual([20_000]);
  });

  it("fails and refunds after retries are exhausted", async () => {
    const { deps, userId, shopId, sourceId, repo } = await setup([
      { kind: "error", status: 500 },
      { kind: "error", status: 500 },
    ]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "editorial", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    const job = repo.jobs.get(jobId)!;
    expect(job.status).toBe("failed");
    expect(job.refunded).toBe(true);
    expect(repo.attempts).toHaveLength(2);
    expect(repo.balances.get(shopId)).toBe(10);
    expect(repo.ledgerSum(shopId)).toBe(10);
  });

  it("does not retry a content-policy refusal, and refunds", async () => {
    const { deps, userId, shopId, sourceId, repo, mock } = await setup([{ kind: "error", status: 400, code: "moderation_blocked" }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    expect(mock.calls).toHaveLength(1);
    expect(repo.jobs.get(jobId)!).toMatchObject({ status: "failed", errorCode: "content_blocked", refunded: true });
    expect(repo.jobs.get(jobId)!.errorMessage).toMatch(/declined this photo/);
    expect(repo.balances.get(shopId)).toBe(10);
  });

  it("refunds once even if failure and the watchdog both fire", async () => {
    const { deps, userId, shopId, sourceId, repo } = await setup([{ kind: "error", status: 401 }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "velvet", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);
    await repo.failJob(jobId, "timeout", "again", true);
    await repo.expireStaleJobs();
    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(1);
    expect(repo.balances.get(shopId)).toBe(10);
  });

  it("refuses to start without enough credits, and creates no job", async () => {
    const { deps, userId, sourceId, repo } = await setup([], 1);
    await expectDomainError(
      submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "marble", idempotencyKey: key() }),
      "insufficient_credits",
    );
    expect(repo.jobs.size).toBe(0);
  });

  it("enforces the concurrent-jobs limit", async () => {
    const { deps, userId, sourceId } = await setup([], 50);
    for (let i = 0; i < 3; i++) {
      await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    }
    await expectDomainError(
      submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() }),
      "too_many_active_jobs",
    );
  });

  it("blocks access to another shop's photo and jobs", async () => {
    const { deps, userId, sourceId, repo } = await setup([{ kind: "ok" }]);
    const intruder = randomUUID();
    repo.addShop(intruder, 10);
    await expectDomainError(
      submitGeneration(deps, intruder, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() }),
      "not_found",
    );
    expect(repo.jobs.size).toBe(0);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    await expectDomainError(getGenerationView(deps, intruder, jobId), "not_found");
    await expectDomainError(downloadUrl(deps, intruder, jobId), "not_found");
  });

  it("does not let viewers generate", async () => {
    const { deps, sourceId, repo, shopId } = await setup([]);
    const viewer = randomUUID();
    repo.members.set(viewer, { shopId, role: "viewer" });
    await expectDomainError(
      submitGeneration(deps, viewer, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() }),
      "forbidden",
    );
  });

  it("supports approve, discard and download", async () => {
    const { deps, userId, sourceId } = await setup([{ kind: "ok" }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "black-luxury", idempotencyKey: key() });
    await runGenerationJob(deps, jobId);

    await reviewGeneration(deps, userId, jobId, "approved");
    expect((await getGenerationView(deps, userId, jobId)).result?.reviewStatus).toBe("approved");
    expect(await downloadUrl(deps, userId, jobId)).toContain("download=necklace_black-luxury.png");

    await reviewGeneration(deps, userId, jobId, "discarded");
    expect((await getGenerationView(deps, userId, jobId)).result).toBeNull();
    await expectDomainError(downloadUrl(deps, userId, jobId), "not_found");
  });

  it("is honest when no provider is configured: nothing is charged or simulated", async () => {
    const { deps, userId, sourceId, repo } = await setup([]);
    const noProvider = { ...deps, provider: null };
    await expectDomainError(
      submitGeneration(noProvider, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() }),
      "provider_not_configured",
    );
    expect(repo.jobs.size).toBe(0);
    expect(repo.generated.size).toBe(0);
  });

  it("discards a result that arrives after the watchdog already refunded the job", async () => {
    const { deps, userId, shopId, sourceId, repo, storage } = await setup([{ kind: "ok" }]);
    const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: key() });
    const realEdit = deps.provider!.editImage.bind(deps.provider);
    deps.provider = {
      id: "openai",
      model: "gpt-image-2.5-sunburst",
      editImage: async (req) => {
        const result = await realEdit(req);
        await repo.failJob(jobId, "timeout", "expired", true); // watchdog fires mid-flight
        return result;
      },
    };
    await runGenerationJob(deps, jobId);
    expect(repo.jobs.get(jobId)!.status).toBe("failed");
    expect(repo.generated.size).toBe(0);
    expect(storage.objects.has(`generated/${shopId}/${jobId}/result.png`)).toBe(false);
    expect(repo.balances.get(shopId)).toBe(10);
  });
});

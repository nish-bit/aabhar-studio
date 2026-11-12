import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenerationQueue } from "@/server/generation/dispatch";
import { submitGeneration, type GenerationDeps } from "@/server/generation/service";
import { OpenAIImageProvider } from "@/server/providers/image/openai";

import { FakeRepository, FakeStorage } from "../support/fakes";

/**
 * The generation producer (src/server/generation/dispatch.ts): on Cloudflare
 * Workers a paid-for job is sent to GENERATION_QUEUE; elsewhere it runs with
 * after(). A failed send must never cost the customer credits, and must never
 * refund twice.
 */

const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const afterCalls = vi.hoisted(() => [] as unknown[]);

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env, ctx: {}, cf: undefined }) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: unknown) => void afterCalls.push(task),
}));

async function loadDispatch(runtime: "workers" | "node") {
  vi.resetModules();
  if (runtime === "workers") vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  return import("@/server/generation/dispatch");
}

/** A paid-for job, as submitGeneration leaves it (credits already debited). */
async function paidJob(credits = 5) {
  const repo = new FakeRepository();
  const logs: string[] = [];
  // A configured provider (submitGeneration refuses jobs without one); dispatch never calls it.
  const provider = new OpenAIImageProvider({
    apiKey: "sk-test",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    timeoutMs: 5_000,
    fetchImpl: async () => {
      throw new Error("the provider must not be called by dispatch");
    },
  });
  const deps: GenerationDeps = {
    repo,
    storage: new FakeStorage(),
    provider,
    limits: { maxActiveJobs: 3, dailyLimit: 200 },
    log: (event) => void logs.push(event),
  };
  const userId = randomUUID();
  const shopId = repo.addShop(userId, credits);
  const sourceImageId = repo.addReadySource(shopId, userId);
  const { jobId } = await submitGeneration(deps, userId, { sourceImageId, presetSlug: "white-studio", idempotencyKey: randomUUID().replace(/-/g, "") });
  return { repo, deps, logs, shopId, jobId };
}

function queue(behaviour: "ok" | "fail") {
  const sent: unknown[][] = [];
  const q: GenerationQueue = {
    async send(...args) {
      sent.push(args);
      if (behaviour === "fail") throw new Error("Queue send failed: 503");
    },
  };
  return { q, sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
  cf.env = {};
  afterCalls.length = 0;
});

describe("dispatchGenerationJob on Cloudflare Workers", () => {
  it("sends the job id to GENERATION_QUEUE and doesn't use after()", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, repo, shopId } = await paidJob();
    const { q, sent } = queue("ok");
    cf.env = { GENERATION_QUEUE: q };

    expect(await dispatchGenerationJob(deps, jobId, { newJob: true })).toBe("queued");
    expect(sent).toEqual([[{ jobId }, { contentType: "json" }]]);
    expect(afterCalls).toHaveLength(0);
    // Credits were debited once by submitGeneration; dispatch doesn't touch them.
    expect(repo.jobs.get(jobId)!.status).toBe("queued");
    expect(repo.balances.get(shopId)).toBe(4);
  });

  it("falls back to after() when the queue isn't bound, and says so in the logs", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, logs } = await paidJob();

    expect(await dispatchGenerationJob(deps, jobId, { newJob: true })).toBe("background");
    expect(afterCalls).toHaveLength(1);
    expect(logs).toContain("generation.queue_not_configured");
  });

  it("refunds a new job at once when the send fails", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, repo, shopId } = await paidJob();
    cf.env = { GENERATION_QUEUE: queue("fail").q };

    expect(await dispatchGenerationJob(deps, jobId, { newJob: true })).toBe("refunded");
    const job = repo.jobs.get(jobId)!;
    expect(job).toMatchObject({ status: "failed", errorCode: "not_started", refunded: true });
    expect(repo.balances.get(shopId)).toBe(5);
    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(1);
  });

  it("refunds only once, even if a failed send is followed by another failure and the watchdog", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, repo, shopId } = await paidJob();
    const failing = queue("fail").q;

    await dispatchGenerationJob(deps, jobId, { newJob: true, queue: failing });
    expect(await dispatchGenerationJob(deps, jobId, { newJob: true, queue: failing })).toBe("enqueue_failed");
    await repo.failJob(jobId, "timeout", "again", true);
    await repo.expireStaleJobs();

    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(1);
    expect(repo.balances.get(shopId)).toBe(5);
  });

  it("never fails a replayed request's job when its send fails (the original request owns it, and it may be running)", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, repo, shopId } = await paidJob();
    await repo.claimJob(jobId, 295); // the original request's run has started

    expect(await dispatchGenerationJob(deps, jobId, { newJob: false, queue: queue("fail").q })).toBe("enqueue_failed");
    expect(repo.jobs.get(jobId)!.status).toBe("processing");
    expect(repo.balances.get(shopId)).toBe(4);
  });

  it("leaves the job for the watchdog if the refund itself can't be written", async () => {
    const { dispatchGenerationJob } = await loadDispatch("workers");
    const { deps, jobId, repo, logs } = await paidJob();
    repo.failJob = async () => {
      throw new Error("database unreachable");
    };

    expect(await dispatchGenerationJob(deps, jobId, { newJob: true, queue: queue("fail").q })).toBe("enqueue_failed");
    expect(logs).toEqual(expect.arrayContaining(["generation.enqueue_failed", "generation.enqueue_refund_failed"]));
    expect(repo.jobs.get(jobId)!.status).toBe("queued");
  });
});

describe("dispatchGenerationJob elsewhere (next dev, Node, Vercel)", () => {
  it("keeps after(), and ignores a queue binding exposed by the local dev proxy", async () => {
    const { dispatchGenerationJob } = await loadDispatch("node");
    const { deps, jobId } = await paidJob();
    const { q, sent } = queue("ok");
    cf.env = { GENERATION_QUEUE: q };

    expect(await dispatchGenerationJob(deps, jobId, { newJob: true })).toBe("background");
    expect(afterCalls).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });
});

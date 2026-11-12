import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationQueue } from "@/server/generation/dispatch";
import { BUCKETS } from "@/server/generation/ports";
import { submitGeneration, type GenerationDeps } from "@/server/generation/service";
import { OpenAIImageProvider } from "@/server/providers/image/openai";
import { GENERATION_DLQ, GENERATION_QUEUE, handleQueueBatch, type QueueMessage } from "@/worker/background";

import { FakeRepository, FakeStorage } from "../support/fakes";
import { makeJpeg } from "../support/images";
import { mockOpenAIFetch, type MockReply } from "../support/openai-mock";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Queue-based generation end to end: the producer sends the job, the consumer
 * delivers it through the service binding to the real internal route, which
 * runs the real runGenerationJob. Checks one charge, one result and at most one
 * refund across duplicates, retries, a lost Worker and the dead-letter path.
 */

const current = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/server/generation/deps", () => ({ generationDeps: () => current.deps }));

const SECRET = "q".repeat(48);

// The first delivery imports the route module (and the image pipeline behind it), and the
// PGlite test applies every migration; both are slow while the whole suite runs in
// parallel. That's import and setup cost, not a hang (same allowance as admin-routes).
vi.setConfig({ testTimeout: 30_000 });

async function setup(replies: MockReply[], credits = 5) {
  const repo = new FakeRepository();
  const storage = new FakeStorage();
  const mock = mockOpenAIFetch(replies);
  const provider = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-2.5-sunburst", quality: "high", timeoutMs: 5_000, fetchImpl: mock.fetchImpl });
  const deps: GenerationDeps = { repo, storage, provider, limits: { maxActiveJobs: 3, dailyLimit: 200 }, sleep: async () => undefined };
  current.deps = deps;
  const userId = randomUUID();
  const shopId = repo.addShop(userId, credits);
  const sourceId = repo.addReadySource(shopId, userId);
  storage.put(BUCKETS.originals, repo.sources.get(sourceId)!.storagePath!, await makeJpeg());
  const { jobId } = await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: randomUUID().replace(/-/g, "") });
  return { repo, deps, mock, shopId, jobId };
}

/** In-memory queue: records sends; deliver() hands them to the consumer like Cloudflare would. */
function memoryQueue() {
  const pending: { body: unknown; attempts: number }[] = [];
  const outcomes: { acked: boolean; retried: boolean; delaySeconds?: number }[] = [];
  const queue: GenerationQueue = {
    async send(body) {
      pending.push({ body, attempts: 1 });
    },
  };
  /** The service binding: calls the real route handler. */
  const self = {
    async fetch(request: Request) {
      const { POST } = await import("@/app/api/internal/generation/run/route");
      return POST(request);
    },
  };
  async function deliver(queueName = GENERATION_QUEUE) {
    const batch = pending.splice(0);
    const messages: QueueMessage[] = batch.map((m) => {
      const outcome: (typeof outcomes)[number] = { acked: false, retried: false };
      outcomes.push(outcome);
      return {
        id: randomUUID(),
        body: m.body,
        attempts: m.attempts,
        ack: () => void (outcome.acked = true),
        retry: (o) => {
          outcome.retried = true;
          outcome.delaySeconds = o?.delaySeconds;
          pending.push({ body: m.body, attempts: m.attempts + 1 }); // redelivered later
        },
      };
    });
    await handleQueueBatch({ queue: queueName, messages }, { WORKER_SELF_REFERENCE: self, JOB_RUNNER_SECRET: SECRET }, () => undefined);
  }
  return { queue, pending, outcomes, deliver };
}

async function dispatch(deps: GenerationDeps, jobId: string, queue: GenerationQueue, newJob = true) {
  const { dispatchGenerationJob } = await import("@/server/generation/dispatch");
  return dispatchGenerationJob(deps, jobId, { newJob, queue });
}

beforeEach(() => vi.stubEnv("JOB_RUNNER_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("queue-based generation", () => {
  it("producer → consumer → internal route: generates once and charges once", async () => {
    const { repo, deps, mock, shopId, jobId } = await setup([{ kind: "ok" }]);
    const q = memoryQueue();

    expect(await dispatch(deps, jobId, q.queue)).toBe("queued");
    await q.deliver();

    expect(q.outcomes).toEqual([{ acked: true, retried: false }]);
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(repo.generated.size).toBe(1);
    expect(mock.calls).toHaveLength(1);
    expect(repo.balances.get(shopId)).toBe(4);
  });

  it("duplicate messages (an Idempotency-Key replay, or a redelivery) run the job once", async () => {
    const { repo, deps, mock, shopId, jobId } = await setup([{ kind: "ok" }, { kind: "ok" }]);
    const q = memoryQueue();
    await dispatch(deps, jobId, q.queue);
    await dispatch(deps, jobId, q.queue, false); // replayed request
    expect(q.pending).toHaveLength(2);

    await q.deliver();

    expect(q.outcomes.every((o) => o.acked && !o.retried)).toBe(true);
    expect(mock.calls).toHaveLength(1);
    expect(repo.generated.size).toBe(1);
    expect(repo.balances.get(shopId)).toBe(4);
    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(0);
  });

  it("retries with backoff when the database is briefly unreachable, then completes once", async () => {
    const { repo, deps, mock, shopId, jobId } = await setup([{ kind: "ok" }]);
    const realClaim = repo.claimJob.bind(repo);
    let outages = 1;
    repo.claimJob = async (...args) => {
      if (outages-- > 0) throw new Error("connect ETIMEDOUT");
      return realClaim(...args);
    };
    const q = memoryQueue();
    await dispatch(deps, jobId, q.queue);

    await q.deliver(); // 503 from the route → retried in 15 s
    expect(q.outcomes[0]).toEqual({ acked: false, retried: true, delaySeconds: 15 });
    expect(repo.jobs.get(jobId)!.status).toBe("queued");

    await q.deliver(); // redelivery, attempt 2
    expect(q.outcomes[1]).toEqual({ acked: true, retried: false });
    expect(repo.jobs.get(jobId)!.status).toBe("succeeded");
    expect(mock.calls).toHaveLength(1);
    expect(repo.balances.get(shopId)).toBe(4);
  });

  it("a fatal provider error fails and refunds the job once; the message is still acked (no retry storm)", async () => {
    const { repo, deps, shopId, jobId } = await setup([{ kind: "error", status: 401 }]);
    const q = memoryQueue();
    await dispatch(deps, jobId, q.queue);
    await q.deliver();

    expect(q.outcomes).toEqual([{ acked: true, retried: false }]);
    expect(repo.jobs.get(jobId)!).toMatchObject({ status: "failed", refunded: true });
    expect(repo.balances.get(shopId)).toBe(5);
    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(1);
  });

  it("recovers from a Worker lost mid-run: the redelivery is a no-op and the watchdog refunds exactly once", async () => {
    const { repo, deps, mock, shopId, jobId } = await setup([{ kind: "ok" }]);
    let clock = Date.now();
    repo.now = () => clock;
    // The first consumer claimed the job, then its Worker was lost before finishing.
    await repo.claimJob(jobId, 295);

    const q = memoryQueue();
    await dispatch(deps, jobId, q.queue, false);
    await q.deliver(); // redelivered message: the claim finds the job already processing
    expect(q.outcomes).toEqual([{ acked: true, retried: false }]);
    expect(mock.calls).toHaveLength(0);
    expect(repo.jobs.get(jobId)!.status).toBe("processing");

    clock += 296_000; // the lease ran out
    expect(await repo.expireStaleJobs()).toBe(1);
    expect(await repo.expireStaleJobs()).toBe(0);
    await dispatch(deps, jobId, q.queue, false); // a very late duplicate
    await q.deliver();

    expect(repo.jobs.get(jobId)!).toMatchObject({ status: "failed", refunded: true });
    expect(repo.ledger.filter((l) => l.type === "refund")).toHaveLength(1);
    expect(repo.balances.get(shopId)).toBe(5);
    expect(mock.calls).toHaveLength(0);
  });

  it("ends in the dead-letter queue after 5 retries when the job can never run", async () => {
    const { repo, deps, jobId } = await setup([]);
    repo.claimJob = async () => {
      throw new Error("database unreachable");
    };
    const q = memoryQueue();
    await dispatch(deps, jobId, q.queue);
    for (let i = 0; i < 6; i++) await q.deliver();

    // 6 deliveries (1 + max_retries 5), each retried with a longer delay; Cloudflare then dead-letters it.
    expect(q.outcomes.map((o) => o.delaySeconds)).toEqual([15, 30, 60, 120, 240, 240]);
    const dlq = memoryQueue();
    dlq.pending.push({ body: { jobId }, attempts: 6 });
    await dlq.deliver(GENERATION_DLQ);
    expect(dlq.outcomes).toEqual([{ acked: true, retried: false }]);
    expect(repo.jobs.get(jobId)!.status).toBe("queued"); // the watchdog refunds it (next test, real SQL)
  });
});

describe("dead-lettered jobs and the watchdog (real SQL, PGlite)", () => {
  it("a job that never started is failed and refunded exactly once, and can't start afterwards", async () => {
    const { pg } = await createTestDatabase();
    const u = await createUser(pg);
    await pg.query(`select public.grant_credits($1, 3, 'admin', null, $2, 'test')`, [u.shopId, randomUUID()]);
    const sourceId = randomUUID();
    await pg.query(
      `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path, storage_path, mime_type, width, height, status)
       values ($1, $2, $3, 'ring.jpg', 'image/jpeg', 1000, $4, $5, 'image/jpeg', 1200, 1200, 'ready')`,
      [sourceId, u.shopId, u.userId, `${u.shopId}/${sourceId}/up.jpg`, `${u.shopId}/${sourceId}/src.jpg`],
    );
    const balance = async () => (await pg.query<{ balance: number }>("select balance from public.credit_balances where shop_id = $1", [u.shopId])).rows[0]!.balance;
    const before = await balance();
    const { rows } = await pg.query<{ r_job_id: string }>(
      `select * from public.create_generation_job($1, $2, $3, 'white-studio', 1, null, 1, 'openai', 'm', $4, 10, 1000)`,
      [u.userId, u.shopId, sourceId, randomUUID()],
    );
    const jobId = rows[0]!.r_job_id;
    expect(await balance()).toBe(before - 1);

    // All deliveries failed; the message was dead-lettered and the job is still queued, 11 minutes on.
    await pg.query(`update public.generation_jobs set created_at = now() - interval '11 minutes' where id = $1`, [jobId]);
    const expire = async () => (await pg.query<{ n: number }>("select public.expire_stale_generation_jobs() as n")).rows[0]!.n;
    expect(await expire()).toBe(1);
    expect(await expire()).toBe(0);

    const job = (await pg.query<{ status: string; error_code: string; refunded: boolean }>("select status, error_code, refunded from public.generation_jobs where id = $1", [jobId])).rows[0]!;
    expect(job).toEqual({ status: "failed", error_code: "not_started", refunded: true });
    const refunds = await pg.query("select 1 from public.credit_ledger where job_id = $1 and entry_type = 'refund'", [jobId]);
    expect(refunds.rows).toHaveLength(1);
    expect(await balance()).toBe(before);
    // A late redelivery can't start it: the claim only takes queued jobs.
    expect((await pg.query("select * from public.claim_generation_job($1, 295)", [jobId])).rows).toHaveLength(0);
  }, 60_000);
});

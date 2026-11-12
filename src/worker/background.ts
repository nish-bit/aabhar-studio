/**
 * Background entry points for the Cloudflare Worker (worker.ts): the Queue
 * consumer that runs image generations and the Cron Trigger handler.
 *
 * Both run outside Next.js, so neither contains business logic. They call the
 * app's own routes through the WORKER_SELF_REFERENCE service binding, and the
 * routes do the work with the existing, tested code:
 *
 * - a generation message → POST /api/internal/generation/run, which runs
 *   runGenerationJob. Its atomic claim (queued → processing) makes duplicate
 *   or late deliveries harmless, and every refund is keyed per job, so a job is
 *   charged once and refunded at most once however often a message arrives.
 * - a cron schedule → GET /api/cron/*, with the same CRON_SECRET check the
 *   routes have always used.
 *
 * No Next.js or app imports here: this file is bundled into worker.ts.
 */

export const GENERATION_QUEUE = "aabhar-generation";
export const GENERATION_DLQ = "aabhar-generation-dlq";
export const RUN_JOB_PATH = "/api/internal/generation/run";

/**
 * Service-binding requests need an absolute URL, but the binding routes them
 * straight to this Worker: the host is never resolved or reachable from outside.
 */
const INTERNAL_ORIGIN = "https://aabhar-studio.internal";

/** Queue message body sent by the producer (src/server/generation/dispatch.ts). */
export interface GenerationMessage {
  jobId: string;
}

/** The parts of Cloudflare's queue Message the consumer uses. */
export interface QueueMessage<Body = unknown> {
  readonly id: string;
  readonly body: Body;
  /** 1 on the first delivery. */
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/** The parts of Cloudflare's MessageBatch the consumer uses. */
export interface QueueBatch<Body = unknown> {
  readonly queue: string;
  readonly messages: readonly QueueMessage<Body>[];
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface BackgroundEnv {
  WORKER_SELF_REFERENCE?: Fetcher;
  JOB_RUNNER_SECRET?: string;
  CRON_SECRET?: string;
}

export type BackgroundLog = (event: string, data: Record<string, unknown>) => void;

/** Structured logs; failures go to console.error so Workers Logs can alert on them. Never logs secrets. */
const defaultLog: BackgroundLog = (event, data) => {
  const line = JSON.stringify({ event, ...data });
  if (/failed|rejected|dead_letter|invalid|misconfigured|unknown/.test(event)) console.error(line);
  else console.log(line);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jobIdOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const jobId = (body as { jobId?: unknown }).jobId;
  return typeof jobId === "string" && UUID.test(jobId) ? jobId : null;
}

/**
 * Exponential backoff for a failed delivery: 15, 30, 60, 120, then 240 s.
 * With max_retries 5 (wrangler.jsonc) that's under 8 minutes in all, inside
 * the watchdog's 10-minute window for jobs that never start. After that the
 * message goes to the dead-letter queue and the watchdog refunds the job.
 */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(15 * 2 ** Math.max(0, attempts - 1), 240);
}

/** Queue consumer for both the generation queue and its dead-letter queue. */
export async function handleQueueBatch(batch: QueueBatch, env: BackgroundEnv, log: BackgroundLog = defaultLog): Promise<void> {
  if (batch.queue === GENERATION_DLQ) {
    // Retries are exhausted. The job is still queued or processing, and the
    // stuck-job watchdog (/api/cron/expire-jobs) fails and refunds it, once.
    for (const message of batch.messages) {
      log("generation.dead_letter", { messageId: message.id, jobId: jobIdOf(message.body), attempts: message.attempts });
      message.ack();
    }
    return;
  }
  if (batch.queue !== GENERATION_QUEUE) {
    log("queue.unknown", { queue: batch.queue, messages: batch.messages.length });
    for (const message of batch.messages) message.retry();
    return;
  }
  // Sequential: max_batch_size is 1, and one long OpenAI call per invocation keeps failures separate.
  for (const message of batch.messages) await runGenerationMessage(message, env, log);
}

async function runGenerationMessage(message: QueueMessage, env: BackgroundEnv, log: BackgroundLog): Promise<void> {
  const jobId = jobIdOf(message.body);
  const context = { messageId: message.id, jobId, attempts: message.attempts };
  if (!jobId) {
    // Retrying can't fix a malformed message.
    log("generation.message_invalid", { messageId: message.id });
    message.ack();
    return;
  }

  const retry = (reason: string, extra: Record<string, unknown> = {}) => {
    const delaySeconds = retryDelaySeconds(message.attempts);
    log("generation.run_failed", { ...context, reason, retryInSeconds: delaySeconds, ...extra });
    message.retry({ delaySeconds });
  };

  const self = env.WORKER_SELF_REFERENCE;
  const secret = env.JOB_RUNNER_SECRET;
  if (!self || !secret) {
    // A deployment problem; retrying gives time to fix it, then the DLQ and the watchdog take over.
    log("generation.runner_misconfigured", { ...context, missing: !self ? "WORKER_SELF_REFERENCE" : "JOB_RUNNER_SECRET" });
    retry("misconfigured");
    return;
  }

  let response: Response;
  try {
    response = await self.fetch(
      new Request(INTERNAL_ORIGIN + RUN_JOB_PATH, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId } satisfies GenerationMessage),
      }),
    );
  } catch (err) {
    retry("fetch_error", { error: String(err).slice(0, 200) });
    return;
  }
  await response.body?.cancel().catch(() => undefined);

  if (response.ok) {
    // Ran to completion, or there was nothing to do (already running, finished or unknown).
    log("generation.run_completed", { ...context, status: response.status });
    message.ack();
    return;
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    // The request itself was refused (bad secret, bad body, runner disabled): retrying won't help.
    // The job stays queued and the watchdog refunds it.
    log("generation.run_rejected", { ...context, status: response.status });
    message.ack();
    return;
  }
  retry("http_error", { status: response.status });
}

/** Cron expression (UTC, as in wrangler.jsonc "triggers.crons") → the existing routes it runs. */
export const CRON_TASKS: Readonly<Record<string, readonly string[]>> = {
  // Stuck-job watchdog: fails and refunds jobs that never started or outlived their lease.
  "*/10 * * * *": ["/api/cron/expire-jobs"],
  // Expires lapsed credits and confirms pack payments whose webhook didn't arrive.
  "17 * * * *": ["/api/cron/billing"],
  // Data-retention sweep.
  "23 21 * * *": ["/api/cron/retention"],
};

export interface CronTaskResult {
  path: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
}

/**
 * Runs every task for a cron schedule. Tasks run independently: one failing
 * doesn't stop the others. If any failed, this throws after all have finished,
 * so Cloudflare records the scheduled run as failed. Every route is safe to run
 * twice or overlap (row locks, `skip locked`, per-job refund keys, batched
 * deletes by id), so no cross-run lock is needed.
 */
export async function runScheduled(
  cron: string,
  env: BackgroundEnv,
  options: { tasks?: Readonly<Record<string, readonly string[]>>; log?: BackgroundLog; now?: () => number } = {},
): Promise<CronTaskResult[]> {
  const log = options.log ?? defaultLog;
  const now = options.now ?? Date.now;
  const paths = (options.tasks ?? CRON_TASKS)[cron];
  if (!paths?.length) {
    log("cron.unknown_schedule", { cron });
    throw new Error(`No scheduled task for cron "${cron}".`);
  }
  const self = env.WORKER_SELF_REFERENCE;
  const secret = env.CRON_SECRET;
  if (!self || !secret) {
    log("cron.misconfigured", { cron, missing: !self ? "WORKER_SELF_REFERENCE" : "CRON_SECRET" });
    throw new Error("Scheduled tasks need the WORKER_SELF_REFERENCE binding and the CRON_SECRET secret.");
  }

  const results = await Promise.all(
    paths.map(async (path): Promise<CronTaskResult> => {
      const started = now();
      try {
        const response = await self.fetch(
          new Request(INTERNAL_ORIGIN + path, { method: "GET", headers: { authorization: `Bearer ${secret}` } }),
        );
        // Task summaries are counts only (e.g. {"expired":2}); keep the log small.
        const text = (await response.text()).slice(0, 2_000);
        const result = { path, ok: response.ok, status: response.status, durationMs: now() - started };
        log(response.ok ? "cron.completed" : "cron.failed", { cron, ...result, ...(response.ok ? { summary: parseJson(text) } : {}) });
        return result;
      } catch (err) {
        const result = { path, ok: false, status: null, durationMs: now() - started };
        log("cron.failed", { cron, ...result, error: String(err).slice(0, 200) });
        return result;
      }
    }),
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    throw new Error(`Cron "${cron}": ${failed.length} of ${results.length} task(s) failed: ${failed.map((r) => r.path).join(", ")}.`);
  }
  return results;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

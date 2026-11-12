import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { after } from "next/server";

import { runGenerationJob, type GenerationDeps } from "./service";

/** Cloudflare Queue producer binding (wrangler.jsonc "queues.producers"). */
export interface GenerationQueue {
  send(body: { jobId: string }, options?: { contentType?: "json" }): Promise<unknown>;
}

declare global {
  interface CloudflareEnv {
    GENERATION_QUEUE?: GenerationQueue;
  }
}

/** Same message and code the watchdog uses for a job that never started. */
const NOT_STARTED_MESSAGE = "This generation didn't start. Your credits were returned.";

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** The queue on Cloudflare Workers; null elsewhere (next dev, Node, Vercel) or when it isn't bound. */
function workersQueue(): GenerationQueue | null {
  if (!onWorkers) return null;
  try {
    return getCloudflareContext().env.GENERATION_QUEUE ?? null;
  } catch {
    return null;
  }
}

export type DispatchOutcome =
  /** Sent to the queue; the consumer runs it. */
  | "queued"
  /** Running after the response with after() (no queue here). */
  | "background"
  /** The send failed, so this request's new job was failed and refunded at once. */
  | "refunded"
  /** The send failed and the job was left for its original request or the watchdog. */
  | "enqueue_failed";

export interface DispatchOptions {
  /**
   * True when this request created the job (not an Idempotency-Key replay, or
   * an admin retry). Only then may a failed send fail the job: nothing else can
   * have queued or started it. A replay's job belongs to the original request
   * and may already be running.
   */
  newJob: boolean;
  /** Overrides for tests. */
  queue?: GenerationQueue | null;
  runInBackground?: (task: () => Promise<void>) => void;
}

/**
 * Starts a job that submitGeneration (or an admin retry) has created and paid for.
 *
 * - Cloudflare Workers: sends `{ jobId }` to GENERATION_QUEUE, and the consumer
 *   runs it through /api/internal/generation/run. after() isn't used there:
 *   Workers stop it about 30 s after the response, mid-generation.
 * - Elsewhere, or if the queue isn't bound: after(), as before.
 *
 * Duplicate starts are harmless (the job's atomic claim lets only one run). A
 * job that is never started is failed and refunded by the watchdog within ~10
 * minutes; a failed send of a new job refunds straight away.
 */
export async function dispatchGenerationJob(deps: GenerationDeps, jobId: string, options: DispatchOptions): Promise<DispatchOutcome> {
  const log = deps.log ?? (() => undefined);
  const queue = options.queue !== undefined ? options.queue : workersQueue();

  if (!queue) {
    if (onWorkers && options.queue === undefined) {
      log("generation.queue_not_configured", { jobId, detail: "No GENERATION_QUEUE binding; running with after(), which Workers may stop early." });
    }
    (options.runInBackground ?? after)(() => runGenerationJob(deps, jobId));
    return "background";
  }

  try {
    await queue.send({ jobId }, { contentType: "json" });
    log("generation.enqueued", { jobId });
    return "queued";
  } catch (err) {
    log("generation.enqueue_failed", { jobId, newJob: options.newJob, error: String(err).slice(0, 200) });
    if (!options.newJob) return "enqueue_failed";
    try {
      // Only queued/processing jobs can fail, and the refund is keyed per job: never twice.
      const failed = await deps.repo.failJob(jobId, "not_started", NOT_STARTED_MESSAGE, true);
      return failed ? "refunded" : "enqueue_failed";
    } catch (failErr) {
      // The watchdog refunds it later.
      log("generation.enqueue_refund_failed", { jobId, error: String(failErr).slice(0, 200) });
      return "enqueue_failed";
    }
  }
}

/**
 * Cloudflare Worker entry (wrangler.jsonc "main").
 *
 * Wraps the worker that `opennextjs-cloudflare build` generates in .open-next/:
 * HTTP requests go to it unchanged, and its Durable Object classes are
 * re-exported. Adds what OpenNext doesn't provide:
 * - queue: the image-generation consumer (src/worker/background.ts);
 * - scheduled: the Cron Triggers, which call the existing /api/cron/* routes.
 *
 * Build first (`npx opennextjs-cloudflare build`): .open-next/ is generated.
 */

// The generated files are plain JavaScript that only exists after a build, so
// TypeScript can't type them (and errors when they're missing). Wrangler resolves them.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import openNextWorker from "./.open-next/worker.js";
import { handleQueueBatch, runScheduled, type BackgroundEnv, type QueueBatch } from "./src/worker/background";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

/** The parts of the Workers runtime types used here (the project has no @cloudflare/workers-types). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}
type WorkerEnv = BackgroundEnv & Record<string, unknown>;

const worker = {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return (openNextWorker as { fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> }).fetch(request, env, ctx);
  },

  async queue(batch: QueueBatch, env: WorkerEnv): Promise<void> {
    await handleQueueBatch(batch, env);
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv): Promise<void> {
    await runScheduled(controller.cron, env);
  },
};

export default worker;

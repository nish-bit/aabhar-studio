import { z } from "zod";

import { generationDeps } from "@/server/generation/deps";
import { runGenerationJob } from "@/server/generation/service";
import { bearerTokenMatches } from "@/server/http/bearer";
import { errorResponse, json } from "@/server/http/respond";

/**
 * Runs one queued generation job. Internal: called only by the Queue consumer
 * (src/worker/background.ts) through the WORKER_SELF_REFERENCE service binding,
 * with `Authorization: Bearer $JOB_RUNNER_SECRET`. There's no user session here:
 * the job was already authorised and paid for when it was created.
 *
 * Disabled (404) unless JOB_RUNNER_SECRET is set (32+ characters). Running a job
 * twice is harmless: runGenerationJob only works on a job it moves from queued
 * to processing, and every refund is keyed per job.
 *
 * 200: done, or nothing to do. 503: couldn't run (e.g. the database was
 * unreachable); the consumer retries with backoff.
 */
export const dynamic = "force-dynamic";
/** Same budget as the job lease (JOB_LEASE_SECONDS, 295 s). */
export const maxDuration = 300;

const MIN_SECRET_LENGTH = 32;

const bodySchema = z.object({ jobId: z.uuid() });

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.JOB_RUNNER_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return errorResponse("not_found", "Not found.", 404);
  if (!bearerTokenMatches(req, secret)) return errorResponse("unauthenticated", "Unauthorized.", 401);

  let body: unknown;
  try {
    body = JSON.parse((await req.text()).slice(0, 1_000));
  } catch {
    return errorResponse("invalid_request", "Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse("invalid_request", "A valid jobId is required.", 400);

  const { jobId } = parsed.data;
  try {
    await runGenerationJob(generationDeps(), jobId);
    return json({ ok: true });
  } catch (err) {
    // runGenerationJob records provider failures (and refunds) itself; reaching here means
    // the job couldn't be claimed or updated, e.g. the database was unreachable.
    console.error(JSON.stringify({ event: "generation.run_error", jobId, error: String(err).slice(0, 200) }));
    return errorResponse("internal_error", "The job couldn't run. It will be retried.", 503);
  }
}

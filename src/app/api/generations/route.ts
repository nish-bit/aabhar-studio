import { z } from "zod";

import type { CreateGenerationResponse } from "@/lib/api-types";
import { INSTRUCTIONS_MAX_LENGTH } from "@/lib/upload-limits";
import { JEWELLERY_TYPE_IDS } from "@/lib/jewellery-types";
import { PHOTO_SIZE_IDS } from "@/lib/photo-sizes";
import { PRESET_SLUGS } from "@/lib/presets";
import { generationDeps } from "@/server/generation/deps";
import { dispatchGenerationJob } from "@/server/generation/dispatch";
import { DomainError } from "@/server/generation/domain-error";
import { getGenerationView, submitGeneration } from "@/server/generation/service";
import { json, readJson, withUser } from "@/server/http/respond";

/**
 * On Cloudflare Workers the job goes to a queue and runs in the consumer
 * (src/server/generation/dispatch.ts). Elsewhere the provider call runs after
 * the response via after(), inside this function's time budget. Keep in step
 * with JOB_LEASE_SECONDS (295 s). On Vercel this needs a plan whose limit allows 300 s.
 */
export const maxDuration = 300;

const bodySchema = z.object({
  sourceImageId: z.uuid(),
  presetSlug: z.enum(PRESET_SLUGS),
  instructions: z
    .string()
    .max(INSTRUCTIONS_MAX_LENGTH, `Instructions can be up to ${INSTRUCTIONS_MAX_LENGTH} characters.`)
    .optional(),
  /** Step 4: output frame. Omitted = follow the photo's own shape (original behaviour). */
  photoSize: z.enum(PHOTO_SIZE_IDS).optional(),
  /** Step 1: what the piece is; added to the prompt. */
  jewelleryType: z.enum(JEWELLERY_TYPE_IDS).optional(),
});

const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,100}$/, "Idempotency-Key header must be 16–100 URL-safe characters.");

/**
 * Create a generation. Credits are debited atomically in the database.
 * Repeating a request with the same Idempotency-Key returns the same job
 * and never charges twice.
 */
export const POST = withUser(async (req, user) => {
  const keyHeader = req.headers.get("idempotency-key");
  if (!keyHeader) throw new DomainError("invalid_request", "Idempotency-Key header is required.", 400);
  const idempotencyKey = idempotencyKeySchema.parse(keyHeader);
  const body = bodySchema.parse(await readJson(req));

  const deps = generationDeps();
  const { jobId, replayed, balance } = await submitGeneration(deps, user.id, { ...body, idempotencyKey });

  // Queue on Workers, after() elsewhere. runGenerationJob claims the job atomically,
  // so a replayed request can't start a second run.
  await dispatchGenerationJob(deps, jobId, { newJob: !replayed });

  const job = await getGenerationView(deps, user.id, jobId);
  const response: CreateGenerationResponse = { job, balance, replayed };
  return json(response, { status: replayed ? 200 : 202 });
});

import { z } from "zod";

import type { SourceImageView } from "@/lib/api-types";
import { generationDeps } from "@/server/generation/deps";
import { completeUpload } from "@/server/generation/service";
import { json, withUser } from "@/server/http/respond";

export const maxDuration = 60;

/** Validate the uploaded bytes, strip metadata, and mark the photo ready. */
export const POST = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const source: SourceImageView = await completeUpload(generationDeps(), user.id, id);
  return json(source);
});

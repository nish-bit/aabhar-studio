import { z } from "zod";

import { generationDeps } from "@/server/generation/deps";
import { getGenerationView, reviewGeneration } from "@/server/generation/service";
import { json, readJson, withUser } from "@/server/http/respond";

const bodySchema = z.object({ decision: z.enum(["approved", "discarded"]) });

/** Approve or discard a generated result. */
export const POST = withUser<{ params: Promise<{ id: string }> }>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const { decision } = bodySchema.parse(await readJson(req));
  const deps = generationDeps();
  await reviewGeneration(deps, user.id, id, decision);
  return json(await getGenerationView(deps, user.id, id));
});

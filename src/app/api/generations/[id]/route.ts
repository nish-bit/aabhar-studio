import { z } from "zod";

import type { GenerationView } from "@/lib/api-types";
import { generationDeps } from "@/server/generation/deps";
import { getGenerationView } from "@/server/generation/service";
import { json, withUser } from "@/server/http/respond";

/** Job status for polling. Also sweeps stale jobs so a lost worker can't strand credits. */
export const GET = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const deps = generationDeps();
  await deps.repo.expireStaleJobs();
  const view: GenerationView = await getGenerationView(deps, user.id, id);
  return json(view);
});

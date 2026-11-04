import { z } from "zod";

import { resetPlan } from "@/server/admin/configuration";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

const body = z.object({ reason: z.string() });

export const POST = withAdmin<{ params: Promise<{ id: string }> }>("write", async (req, admin, deps, ctx) => {
  const { reason } = body.parse(await readJson(req));
  return json(await resetPlan(deps, admin, { planId: (await ctx.params).id, reason }));
});

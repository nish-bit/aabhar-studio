import { updatePlan } from "@/server/admin/configuration";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

/** Changes a plan's limits and monthly credits (never its price). Admin role only; audited. */
export const PUT = withAdmin<{ params: Promise<{ id: string }> }>("write", async (req, admin, deps, ctx) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  return json(await updatePlan(deps, admin, { ...body, planId: (await ctx.params).id } as never));
});

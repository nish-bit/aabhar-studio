import { updatePreset } from "@/server/admin/configuration";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

export const PUT = withAdmin<{ params: Promise<{ slug: string }> }>("write", async (req, admin, deps, ctx) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  return json(await updatePreset(deps, admin, { ...body, slug: (await ctx.params).slug } as never));
});

import { getJobDetail } from "@/server/admin/jobs";
import { json, withAdmin } from "@/server/http/admin";

export const GET = withAdmin<{ params: Promise<{ id: string }> }>("read", async (_req, admin, deps, ctx) =>
  json(await getJobDetail(deps, admin, (await ctx.params).id)),
);

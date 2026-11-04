import { getUserDetail } from "@/server/admin/users";
import { json, withAdmin } from "@/server/http/admin";

export const GET = withAdmin<{ params: Promise<{ id: string }> }>("read", async (_req, admin, deps, ctx) =>
  json(await getUserDetail(deps, admin, (await ctx.params).id)),
);

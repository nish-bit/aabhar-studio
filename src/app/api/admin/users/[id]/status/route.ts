import { z } from "zod";

import { setUserDisabled } from "@/server/admin/users";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

const body = z.object({ disabled: z.boolean(), reason: z.string() });

/** Disable or re-enable a customer account. Admin role only; audited. */
export const POST = withAdmin<{ params: Promise<{ id: string }> }>("write", async (req, admin, deps, ctx) => {
  const input = body.parse(await readJson(req));
  return json(await setUserDisabled(deps, admin, { userId: (await ctx.params).id, ...input }));
});

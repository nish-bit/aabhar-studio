import { z } from "zod";

import { retryJob } from "@/server/admin/jobs";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

/** The new job runs after the response, like a customer generation. */
export const maxDuration = 300;

const body = z.object({ reason: z.string() });

export const POST = withAdmin<{ params: Promise<{ id: string }> }>("write", async (req, admin, deps, ctx) => {
  const { reason } = body.parse(await readJson(req));
  return json(await retryJob(deps, admin, { jobId: (await ctx.params).id, reason }), { status: 202 });
});

import { z } from "zod";

import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";
import { decideRefundRequest } from "@/server/support/refund-requests";

type Ctx = { params: Promise<{ id: string }> };

/** Approve (returns credits) or reject a refund request. */
export const POST = withAdmin<Ctx>("write", async (req, admin, deps, { params }) => {
  const id = z.uuid().parse((await params).id);
  return json(await decideRefundRequest(deps.db, admin, id, await readJson(req)));
});

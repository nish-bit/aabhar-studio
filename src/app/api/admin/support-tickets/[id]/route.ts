import { z } from "zod";

import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";
import { respondToTicket } from "@/server/support/tickets";

type Ctx = { params: Promise<{ id: string }> };

/** Reply to a ticket and/or change its status. */
export const POST = withAdmin<Ctx>("write", async (req, admin, deps, { params }) => {
  const id = z.uuid().parse((await params).id);
  return json(await respondToTicket(deps.db, admin, id, await readJson(req)));
});

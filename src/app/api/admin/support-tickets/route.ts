import { z } from "zod";

import { json, withAdmin } from "@/server/http/admin";
import { listTicketsForAdmin } from "@/server/support/tickets";

const statusSchema = z.enum(["open", "answered", "closed"]).nullable();

export const GET = withAdmin("read", async (req, admin, deps) => {
  const status = statusSchema.parse(new URL(req.url).searchParams.get("status") || null);
  return json({ tickets: await listTicketsForAdmin(deps.db, admin, status) });
});

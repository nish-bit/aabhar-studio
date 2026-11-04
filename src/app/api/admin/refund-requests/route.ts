import { z } from "zod";

import { dashboardDeps } from "@/server/dashboard/deps";
import { json, withAdmin } from "@/server/http/admin";
import { listRefundRequestsForAdmin } from "@/server/support/refund-requests";

const statusSchema = z.enum(["pending", "approved", "rejected"]).nullable();

export const GET = withAdmin("read", async (req, admin, deps) => {
  const status = statusSchema.parse(new URL(req.url).searchParams.get("status") || null);
  const storage = dashboardDeps()?.storage ?? null;
  return json({ requests: await listRefundRequestsForAdmin({ db: deps.db, storage }, admin, status) });
});

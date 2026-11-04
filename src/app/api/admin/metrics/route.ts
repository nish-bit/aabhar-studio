import { getMetrics } from "@/server/admin/metrics";
import { json, withAdmin } from "@/server/http/admin";

export const GET = withAdmin("read", async (_req, admin, deps) => json(await getMetrics(deps, admin)));

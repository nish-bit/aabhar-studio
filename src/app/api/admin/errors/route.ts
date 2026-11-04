import { errorSummary } from "@/server/admin/jobs";
import { json, withAdmin } from "@/server/http/admin";

export const GET = withAdmin("read", async (_req, admin, deps) => json(await errorSummary(deps, admin)));

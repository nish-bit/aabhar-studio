import { getAdminConfig } from "@/server/admin/configuration";
import { json, withAdmin } from "@/server/http/admin";

export const GET = withAdmin("read", async (_req, admin, deps) => json(await getAdminConfig(deps, admin)));

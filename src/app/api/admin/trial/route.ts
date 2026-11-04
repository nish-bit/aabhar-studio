import { updateTrial } from "@/server/admin/configuration";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

export const PUT = withAdmin("write", async (req, admin, deps) => json(await updateTrial(deps, admin, (await readJson(req)) as never)));

import { listUsers, userFilterSchema } from "@/server/admin/users";
import { json, withAdmin } from "@/server/http/admin";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const GET = withAdmin("read", async (req, admin, deps) => json(await listUsers(deps, admin, userFilterSchema.parse(query(req)))));

import { jobFilterSchema, listJobs } from "@/server/admin/jobs";
import { json, withAdmin } from "@/server/http/admin";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const GET = withAdmin("read", async (req, admin, deps) => json(await listJobs(deps, admin, jobFilterSchema.parse(query(req)))));

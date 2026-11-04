import { listPayments, paymentFilterSchema } from "@/server/admin/billing";
import { json, withAdmin } from "@/server/http/admin";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const GET = withAdmin("read", async (req, admin, deps) => json(await listPayments(deps, admin, paymentFilterSchema.parse(query(req)))));

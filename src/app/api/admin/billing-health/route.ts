import { getBillingHealth } from "@/server/admin/billing";
import { json, withAdmin } from "@/server/http/admin";

/** Admin billing health (read access). Counts, timestamps, Razorpay ids and yes/no flags only. */
export const GET = withAdmin("read", async (_req, admin, deps) => json(await getBillingHealth(deps, admin)));

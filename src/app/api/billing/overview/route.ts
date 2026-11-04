import { billingDeps } from "@/server/billing/deps";
import { getBillingOverview } from "@/server/billing/service";
import { json, withUser } from "@/server/http/respond";

export const GET = withUser(async (_req, user) => json(await getBillingOverview(billingDeps(), user.id)));

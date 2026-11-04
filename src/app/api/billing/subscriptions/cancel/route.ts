import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { cancelSubscription } from "@/server/billing/service";
import { json, readJson, withUser } from "@/server/http/respond";

const body = z.object({ atCycleEnd: z.boolean().default(true) });

export const POST = withUser(async (req, user) => {
  const { atCycleEnd } = body.parse(await readJson(req));
  return json(await cancelSubscription(billingDeps(), user.id, atCycleEnd));
});

import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { createSubscription } from "@/server/billing/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";

const body = z.object({ planId: z.string().min(1).max(40) });

export const POST = withUser(async (req, user) => {
  await enforceRateLimit("checkoutCreate", user.id);
  return json(await createSubscription(billingDeps(), user, body.parse(await readJson(req))), { status: 201 });
});

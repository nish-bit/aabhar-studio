import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { createPackOrder } from "@/server/billing/service";
import { json, readJson, withUser } from "@/server/http/respond";
import { enforceRateLimit } from "@/server/http/rate-limit";

const body = z.object({ packId: z.string().min(1).max(40), idempotencyKey: z.string().uuid() });

/** Creates a Razorpay order for a credit pack. The amount always comes from server config, never the browser. */
export const POST = withUser(async (req, user) => {
  await enforceRateLimit("checkoutCreate", user.id);
  const input = body.parse(await readJson(req));
  return json(await createPackOrder(billingDeps(), user, input), { status: 201 });
});

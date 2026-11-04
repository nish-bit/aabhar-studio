import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { verifySubscriptionPayment } from "@/server/billing/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";

const body = z.object({
  razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
});

export const POST = withUser(async (req, user) => {
  await enforceRateLimit("checkoutVerify", user.id);
  return json(await verifySubscriptionPayment(billingDeps(), user.id, body.parse(await readJson(req))));
});

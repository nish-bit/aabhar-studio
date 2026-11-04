import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { verifyPackPayment } from "@/server/billing/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";

const body = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
});

/** Checks the Checkout signature, then confirms with Razorpay before granting credits. */
export const POST = withUser(async (req, user) => {
  await enforceRateLimit("checkoutVerify", user.id);
  return json(await verifyPackPayment(billingDeps(), user.id, body.parse(await readJson(req))));
});

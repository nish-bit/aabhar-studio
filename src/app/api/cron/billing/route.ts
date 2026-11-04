import { timingSafeEqual } from "node:crypto";

import { billingDeps } from "@/server/billing/deps";
import { reconcileBilling } from "@/server/billing/service";
import { serverEnv } from "@/server/env";
import { errorResponse, json } from "@/server/http/respond";

/**
 * Hourly: expires lapsed credits and confirms any pack payments whose
 * webhook didn't arrive. `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = !!secret && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) return errorResponse("unauthenticated", "Unauthorized.", 401);
  return json(await reconcileBilling(billingDeps()));
}

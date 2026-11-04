import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/server/env";
import { generationDeps } from "@/server/generation/deps";
import { errorResponse, json } from "@/server/http/respond";

/**
 * Watchdog for stuck jobs (fails and refunds them). Call from Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok =
    !!secret &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) return errorResponse("unauthenticated", "Unauthorized.", 401);

  const expired = await generationDeps().repo.expireStaleJobs();
  return json({ expired });
}

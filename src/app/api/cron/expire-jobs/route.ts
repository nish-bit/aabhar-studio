import { serverEnv } from "@/server/env";
import { generationDeps } from "@/server/generation/deps";
import { DomainError } from "@/server/generation/domain-error";
import { bearerTokenMatches } from "@/server/http/bearer";
import { errorResponse, json } from "@/server/http/respond";

/**
 * Watchdog for stuck jobs (fails and refunds them). Call from Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!bearerTokenMatches(req, serverEnv().CRON_SECRET)) return errorResponse("unauthenticated", "Unauthorized.", 401);

  let deps: ReturnType<typeof generationDeps>;
  try {
    deps = generationDeps();
  } catch (err) {
    // Storage isn't configured: 503, like /api/cron/retention. Anything else is a real error.
    if (err instanceof DomainError && err.code === "storage_not_configured") return errorResponse(err.code, err.message, 503);
    throw err;
  }
  const expired = await deps.repo.expireStaleJobs();
  return json({ expired });
}

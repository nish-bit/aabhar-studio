import { billingDeps } from "@/server/billing/deps";
import { reconcileBilling } from "@/server/billing/service";
import { serverEnv } from "@/server/env";
import { DomainError } from "@/server/generation/domain-error";
import { bearerTokenMatches } from "@/server/http/bearer";
import { errorResponse, json } from "@/server/http/respond";

/**
 * Hourly: expires lapsed credits and confirms any pack payments whose
 * webhook didn't arrive. `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!bearerTokenMatches(req, serverEnv().CRON_SECRET)) return errorResponse("unauthenticated", "Unauthorized.", 401);
  let deps: ReturnType<typeof billingDeps>;
  try {
    deps = billingDeps();
  } catch (err) {
    // The database isn't configured: 503, like /api/cron/retention. Anything else is a real error.
    if (err instanceof DomainError && err.code === "storage_not_configured") return errorResponse(err.code, err.message, 503);
    throw err;
  }
  return json(await reconcileBilling(deps));
}

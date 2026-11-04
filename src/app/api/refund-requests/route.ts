import { dashboardDeps } from "@/server/dashboard/deps";
import { DomainError } from "@/server/generation/domain-error";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";
import { createRefundRequest, listMyRefundRequests, listRefundableImages } from "@/server/support/refund-requests";

function deps() {
  const d = dashboardDeps();
  if (!d) throw new DomainError("storage_not_configured", "Refund requests need the database and storage to be configured.", 503);
  return d;
}

/** The signed-in user's refund requests, and the recent photos they can still ask about. */
export const GET = withUser(async (_req, user) => {
  const d = deps();
  const [requests, images] = await Promise.all([listMyRefundRequests(d, user.id), listRefundableImages(d, user.id)]);
  return json({ requests, images });
});

export const POST = withUser(async (req, user) => {
  await enforceRateLimit("refundRequest", user.id);
  const d = deps();
  const requests = await createRefundRequest(d, user.id, await readJson(req));
  return json({ requests, images: await listRefundableImages(d, user.id) }, { status: 201 });
});

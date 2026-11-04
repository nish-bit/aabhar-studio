import type { CreditsView } from "@/lib/api-types";
import { generationDeps } from "@/server/generation/deps";
import { domainErrors } from "@/server/generation/domain-error";
import { json, withUser } from "@/server/http/respond";

export const GET = withUser(async (_req, user) => {
  const deps = generationDeps();
  const m = await deps.repo.getMembership(user.id);
  if (!m) throw domainErrors.forbidden();
  const body: CreditsView = { balance: await deps.repo.getBalance(m.shopId) };
  return json(body);
});

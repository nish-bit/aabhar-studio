import { database } from "@/server/db/postgres";
import { DomainError } from "@/server/generation/domain-error";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";
import { createTicket, listMyTickets } from "@/server/support/tickets";

function db() {
  const d = database();
  if (!d) throw new DomainError("storage_not_configured", "Support tickets need the database to be configured.", 503);
  return d;
}

/** The signed-in user's own tickets. */
export const GET = withUser(async (_req, user) => json({ tickets: await listMyTickets(db(), user.id) }));

export const POST = withUser(async (req, user) => {
  await enforceRateLimit("supportTicket", user.id);
  return json({ tickets: await createTicket(db(), user.id, await readJson(req)) }, { status: 201 });
});

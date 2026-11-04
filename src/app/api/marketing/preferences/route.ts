import { z } from "zod";

import type { MarketingPreferences } from "@/lib/marketing";
import { database } from "@/server/db/postgres";
import { DomainError } from "@/server/generation/domain-error";
import { json, readJson, withUser } from "@/server/http/respond";
import { getPreferences, isMarketingSchemaMissing, subscribe, unsubscribe } from "@/server/marketing/consent";

const bodySchema = z.object({ subscribed: z.boolean() }).strict();

function db() {
  const d = database();
  if (!d) throw new DomainError("storage_not_configured", "Email preferences need the database to be configured.", 503);
  return d;
}

/** Turns a missing marketing table (migration not applied) into a clear 503 instead of a 500. */
async function ready<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMarketingSchemaMissing(err)) throw err;
    console.error(JSON.stringify({ event: "marketing.schema_missing", route: "/api/marketing/preferences" }));
    throw new DomainError("storage_not_configured", "Email preferences aren't available yet. Please try again later.", 503);
  }
}

/** The signed-in user's own marketing preference. Nobody can read or change anyone else's. */
export const GET = withUser(async (_req, user) => json<MarketingPreferences>(await ready(() => getPreferences(db(), user.id))));

export const PUT = withUser(async (req, user) => {
  const { subscribed } = bodySchema.parse(await readJson(req, 1024));
  const d = db();
  return json<MarketingPreferences>(
    await ready(async () => {
      if (subscribed) await subscribe(d, user.id, "settings");
      else await unsubscribe(d, user.id, "settings");
      return getPreferences(d, user.id);
    }),
  );
});

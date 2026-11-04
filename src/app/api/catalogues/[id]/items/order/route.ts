import { z } from "zod";

import { CATALOGUE_LIMITS } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { reorderCatalogueItems } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

export const PUT = withUser<{ params: Promise<{ id: string }> }>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const { itemIds } = z.object({ itemIds: z.array(z.uuid()).max(CATALOGUE_LIMITS.maxItems) }).parse(await readJson(req));
  await reorderCatalogueItems(catalogueDeps(), user.id, id, itemIds);
  return json({ ok: true });
});

import { z } from "zod";

import { CATALOGUE_LIMITS } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { addCatalogueItems } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

/** Add approved images as products. Non-approved or other shops' images are ignored. */
export const POST = withUser<{ params: Promise<{ id: string }> }>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const { generatedImageIds } = z
    .object({ generatedImageIds: z.array(z.uuid()).min(1).max(CATALOGUE_LIMITS.maxItems) })
    .parse(await readJson(req));
  return json(await addCatalogueItems(catalogueDeps(), user.id, id, generatedImageIds));
});

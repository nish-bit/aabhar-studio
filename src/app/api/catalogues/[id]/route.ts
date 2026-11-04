import { z } from "zod";

import { catalogueSettingsPatchSchema } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { deleteCatalogue, getCatalogue, updateCatalogueSettings } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

type Ctx = { params: Promise<{ id: string }> };
const idOf = async (ctx: Ctx) => z.uuid().parse((await ctx.params).id);

export const GET = withUser<Ctx>(async (_req, user, ctx) => json(await getCatalogue(catalogueDeps(), user.id, await idOf(ctx))));

/** Save settings. `version` must match the last one the client saw. */
export const PATCH = withUser<Ctx>(async (req, user, ctx) => {
  const body = catalogueSettingsPatchSchema.extend({ version: z.number().int().positive() }).parse(await readJson(req));
  const { version, ...patch } = body;
  return json(await updateCatalogueSettings(catalogueDeps(), user.id, await idOf(ctx), version, patch));
});

/** Moves the catalogue to "Recently deleted"; it can be restored. */
export const DELETE = withUser<Ctx>(async (_req, user, ctx) => {
  await deleteCatalogue(catalogueDeps(), user.id, await idOf(ctx));
  return json({ ok: true });
});

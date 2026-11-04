import { z } from "zod";

import { itemPatchSchema } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { removeCatalogueItem, updateCatalogueItem } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

type Ctx = { params: Promise<{ id: string; itemId: string }> };
const ids = async (ctx: Ctx) => {
  const p = await ctx.params;
  return { id: z.uuid().parse(p.id), itemId: z.uuid().parse(p.itemId) };
};

export const PATCH = withUser<Ctx>(async (req, user, ctx) => {
  const { id, itemId } = await ids(ctx);
  await updateCatalogueItem(catalogueDeps(), user.id, id, itemId, itemPatchSchema.parse(await readJson(req, 32_768)));
  return json({ ok: true });
});

export const DELETE = withUser<Ctx>(async (_req, user, ctx) => {
  const { id, itemId } = await ids(ctx);
  await removeCatalogueItem(catalogueDeps(), user.id, id, itemId);
  return json({ ok: true });
});

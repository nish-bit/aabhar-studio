import { z } from "zod";

import { catalogueNameSchema } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { createCatalogue, listCatalogues } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

export const GET = withUser(async (req, user) => {
  const deleted = new URL(req.url).searchParams.get("deleted") === "1";
  return json(await listCatalogues(catalogueDeps(), user.id, deleted));
});

export const POST = withUser(async (req, user) => {
  const { name } = z.object({ name: catalogueNameSchema }).parse(await readJson(req));
  return json(await createCatalogue(catalogueDeps(), user.id, name), { status: 201 });
});

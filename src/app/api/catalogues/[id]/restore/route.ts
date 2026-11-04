import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { restoreCatalogue } from "@/server/catalogue/service";
import { json, withUser } from "@/server/http/respond";

export const POST = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) =>
  json(await restoreCatalogue(catalogueDeps(), user.id, z.uuid().parse((await ctx.params).id))),
);

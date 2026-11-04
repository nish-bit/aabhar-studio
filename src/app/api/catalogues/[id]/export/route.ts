import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { exportCatalogueImages, exportCataloguePdf } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const maxDuration = 180;

/** Build the print PDF or an images ZIP, store it privately, and return a 10-minute download link. */
export const POST = withUser<{ params: Promise<{ id: string }> }>(async (req, user, ctx) => {
  await enforceRateLimit("catalogueExport", user.id);
  const id = z.uuid().parse((await ctx.params).id);
  const { kind } = z.object({ kind: z.enum(["pdf", "images_zip"]) }).parse(await readJson(req));
  const deps = catalogueDeps();
  return json(kind === "pdf" ? await exportCataloguePdf(deps, user.id, id) : await exportCatalogueImages(deps, user.id, id));
});

import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { completeLogoUpload } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

export const POST = withUser(async (req, user) => {
  const { path } = z.object({ path: z.string().min(1).max(300) }).parse(await readJson(req));
  return json(await completeLogoUpload(catalogueDeps(), user.id, path));
});

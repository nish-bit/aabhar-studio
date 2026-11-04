import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { listApprovedImages } from "@/server/catalogue/service";
import { json, withUser } from "@/server/http/respond";

export const GET = withUser(async (req, user) => {
  const before = new URL(req.url).searchParams.get("before");
  return json(await listApprovedImages(catalogueDeps(), user.id, { before: before ? z.iso.datetime().parse(before) : null }));
});

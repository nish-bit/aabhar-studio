import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { signLogoUpload } from "@/server/catalogue/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { json, readJson, withUser } from "@/server/http/respond";

export const POST = withUser(async (req, user) => {
  await enforceRateLimit("logoUpload", user.id);
  const body = z.object({ mimeType: z.string().max(50), sizeBytes: z.number().int().positive() }).parse(await readJson(req));
  return json(await signLogoUpload(catalogueDeps(), user.id, body), { status: 201 });
});

import { businessProfilePatchSchema } from "@/lib/catalogue";
import { catalogueDeps } from "@/server/catalogue/deps";
import { getBusinessProfile, updateBusinessProfile } from "@/server/catalogue/service";
import { json, readJson, withUser } from "@/server/http/respond";

export const GET = withUser(async (_req, user) => json(await getBusinessProfile(catalogueDeps(), user.id)));

export const PATCH = withUser(async (req, user) =>
  json(await updateBusinessProfile(catalogueDeps(), user.id, businessProfilePatchSchema.parse(await readJson(req)))),
);

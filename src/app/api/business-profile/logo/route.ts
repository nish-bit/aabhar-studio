import { catalogueDeps } from "@/server/catalogue/deps";
import { removeLogo } from "@/server/catalogue/service";
import { json, withUser } from "@/server/http/respond";

export const DELETE = withUser(async (_req, user) => json(await removeLogo(catalogueDeps(), user.id)));

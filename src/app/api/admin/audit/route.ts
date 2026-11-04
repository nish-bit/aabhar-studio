import { z } from "zod";

import { queryAudit } from "@/server/admin/audit";
import { json, withAdmin } from "@/server/http/admin";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
const filter = z.object({
  action: z.string().max(60).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(100).optional(),
  actor: z.string().max(200).optional(),
  page: z.coerce.number().int().optional(),
});

export const GET = withAdmin("read", async (req, _admin, deps) => json(await queryAudit(deps.db, filter.parse(query(req)))));

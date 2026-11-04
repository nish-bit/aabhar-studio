import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { changePlan } from "@/server/billing/service";
import { json, readJson, withUser } from "@/server/http/respond";

const body = z.object({ planId: z.string().min(1).max(40) });

export const POST = withUser(async (req, user) => json(await changePlan(billingDeps(), user.id, body.parse(await readJson(req)))));

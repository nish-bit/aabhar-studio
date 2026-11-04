import { grantPromoCredits } from "@/server/admin/users";
import { json, withAdmin } from "@/server/http/admin";
import { readJson } from "@/server/http/respond";

/** Promotional credit grant. Idempotent on idempotencyKey; admin role only; audited. */
export const POST = withAdmin("write", async (req, admin, deps) => {
  const result = await grantPromoCredits(deps, admin, (await readJson(req)) as never);
  return json(result, { status: result.granted ? 201 : 200 });
});

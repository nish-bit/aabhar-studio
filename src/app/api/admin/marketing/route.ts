import { listSubscribers, marketingSummary, subscriberFilterSchema } from "@/server/admin/marketing";
import { json, withAdmin } from "@/server/http/admin";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const GET = withAdmin("read", async (req, admin, deps) => {
  const [summary, subscribers] = await Promise.all([
    marketingSummary(deps, admin),
    listSubscribers(deps, admin, subscriberFilterSchema.parse(query(req))),
  ]);
  return json({ summary, subscribers });
});

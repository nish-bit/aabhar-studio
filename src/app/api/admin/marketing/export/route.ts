import { exportEligibleSubscribersCsv } from "@/server/admin/marketing";
import { withAdmin } from "@/server/http/admin";

/**
 * Eligible subscribers as a CSV download. A POST (from the export button's
 * form) so it gets the same-origin check, and admin role only: email
 * addresses never leave through a GET link that could be shared or prefetched.
 */
export const POST = withAdmin("write", async (_req, admin, deps) => {
  const { csv } = await exportEligibleSubscribersCsv(deps, admin);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aabhar-marketing-subscribers-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
});

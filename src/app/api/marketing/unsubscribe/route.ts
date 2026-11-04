import { NextResponse } from "next/server";

import { database } from "@/server/db/postgres";
import { errorResponse, json } from "@/server/http/respond";
import { unsubscribeByToken } from "@/server/marketing/consent";

/**
 * No-login unsubscribe. The secret token is the only credential, so there is
 * no session or Origin check. Two callers:
 *
 * - The confirm button on /unsubscribe (form field `token`): redirects back
 *   to that page with the outcome.
 * - Mail apps' one-click unsubscribe (RFC 8058: `?token=` in the URL and a
 *   `List-Unsubscribe=One-Click` body): answers 200 with no redirect.
 *
 * GET does nothing, so link scanners that prefetch URLs can't unsubscribe anyone.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const formToken = form?.get("token");
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const token = typeof formToken === "string" ? formToken : (url.searchParams.get("token") ?? "");

  const db = database();
  if (!db) return errorResponse("storage_not_configured", "Unsubscribe isn't available right now. Please try again later.", 503);

  let ok: boolean;
  try {
    ok = await unsubscribeByToken(db, token, oneClick ? "one_click" : "unsubscribe_link");
  } catch (err) {
    console.error(JSON.stringify({ event: "marketing.unsubscribe_failed", error: String(err).slice(0, 200) }));
    if (oneClick) return errorResponse("internal_error", "Something went wrong. Please try again.", 500);
    return NextResponse.redirect(new URL("/unsubscribe?status=error", url.origin), { status: 303 });
  }

  if (oneClick) return ok ? json({ unsubscribed: true }) : errorResponse("not_found", "This unsubscribe link isn't valid.", 404);
  return NextResponse.redirect(new URL(`/unsubscribe?status=${ok ? "done" : "invalid"}`, url.origin), { status: 303 });
}

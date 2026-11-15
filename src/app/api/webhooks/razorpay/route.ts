import { billingDeps } from "@/server/billing/deps";
import { billingLog } from "@/server/billing/log";
import { handleRazorpayWebhook } from "@/server/billing/service";
import { readLimitedBody } from "@/server/http/limited-body";

/** Razorpay's webhook bodies are a few KB; anything near this is not from Razorpay. Measured in bytes. */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Razorpay webhook receiver. The body's size is checked from Content-Length
 * before reading, then counted in bytes while reading. The raw bytes are
 * decoded as strict UTF-8 (BOM kept) and that exact text is verified with the
 * HMAC before anything is parsed. No session or Origin check: the HMAC
 * signature is the authentication.
 */
export async function POST(req: Request) {
  const body = await readLimitedBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    billingLog("billing.webhook_rejected", { reason: body.reason });
    return new Response(body.status === 413 ? "Payload too large" : "Bad request", { status: body.status });
  }
  let raw: string;
  try {
    // fatal: invalid UTF-8 is refused rather than replaced; ignoreBOM: a BOM stays in the signed text.
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body.bytes);
  } catch {
    billingLog("billing.webhook_rejected", { reason: "invalid_utf8" });
    return new Response("Bad request", { status: 400 });
  }

  let result;
  try {
    result = await handleRazorpayWebhook(billingDeps(), raw, {
      signature: req.headers.get("x-razorpay-signature"),
      eventId: req.headers.get("x-razorpay-event-id"),
    });
  } catch (err) {
    billingLog("billing.webhook_unhandled", { error: err });
    return new Response("Error", { status: 500 });
  }
  return Response.json({ outcome: result.outcome }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

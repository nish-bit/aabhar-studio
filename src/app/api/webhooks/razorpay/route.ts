import { billingDeps } from "@/server/billing/deps";
import { handleRazorpayWebhook } from "@/server/billing/service";


const MAX_BODY_BYTES = 512 * 1024;

/**
 * Razorpay webhook receiver. The raw body is read as text and verified
 * before anything is parsed. No session or Origin check: the HMAC signature
 * is the authentication.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  let result;
  try {
    result = await handleRazorpayWebhook(billingDeps(), raw, {
      signature: req.headers.get("x-razorpay-signature"),
      eventId: req.headers.get("x-razorpay-event-id"),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "billing.webhook_unhandled", error: String(err) }));
    return new Response("Error", { status: 500 });
  }
  return Response.json({ outcome: result.outcome }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

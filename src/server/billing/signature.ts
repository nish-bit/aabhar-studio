import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signature checks, done in constant time.
 *
 * - Webhooks: HMAC-SHA256 of the RAW request body with the webhook secret,
 *   sent hex-encoded in X-Razorpay-Signature. The body must not be parsed
 *   and re-serialised before checking.
 * - Checkout (orders): HMAC-SHA256 of `${order_id}|${payment_id}` with the key secret.
 * - Checkout (subscriptions): HMAC-SHA256 of `${payment_id}|${subscription_id}` with the key secret.
 *
 * A matching checkout signature proves the browser's callback wasn't forged,
 * but credits are still only granted after Razorpay itself confirms the
 * payment is captured (API fetch or webhook).
 */

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(expected: string, received: string | null | undefined): boolean {
  if (!received || !/^[0-9a-f]+$/i.test(received)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | null, secret: string): boolean {
  return safeEqualHex(hmacHex(secret, rawBody), signature);
}

export function verifyOrderPaymentSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

export function verifySubscriptionPaymentSignature(paymentId: string, subscriptionId: string, signature: string, keySecret: string): boolean {
  return safeEqualHex(hmacHex(keySecret, `${paymentId}|${subscriptionId}`), signature);
}

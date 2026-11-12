import { timingSafeEqual } from "node:crypto";

/**
 * True when the request's Authorization header is exactly `Bearer <secret>`.
 *
 * Compares UTF-8 bytes in constant time. Lengths are compared in bytes, not
 * characters: a header with non-ASCII characters (e.g. "é", 1 character but 2
 * bytes) can have as many characters as the expected value but more bytes, and
 * timingSafeEqual throws on buffers of different lengths. Such a header is
 * simply wrong (false), never an error. A missing or empty secret never matches.
 */
export function bearerTokenMatches(req: Request, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const sent = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

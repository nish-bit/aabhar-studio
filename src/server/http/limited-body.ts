/**
 * Reads a request body with a hard byte limit, without trusting the client:
 *
 * - A declared Content-Length over the limit is refused before any of the body is read.
 * - A malformed Content-Length is refused.
 * - The body is then counted in bytes as it streams (chunked uploads have no
 *   Content-Length, and a declared length can be wrong); reading stops and the
 *   stream is cancelled as soon as the limit is passed.
 *
 * Returns the exact bytes received, so signatures can be checked over the raw body.
 */
export type LimitedBody =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: 400 | 413; reason: "bad_content_length" | "too_large" };

export async function readLimitedBody(req: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const value = declared.trim();
    if (!/^\d{1,15}$/.test(value)) return { ok: false, status: 400, reason: "bad_content_length" };
    if (Number(value) > maxBytes) return { ok: false, status: 413, reason: "too_large" };
  }
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, reason: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes };
}

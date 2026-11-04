import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { BUCKETS } from "@/server/generation/ports";
import { completeUpload, signUpload, type GenerationDeps } from "@/server/generation/service";
import { ImageValidationError, sanitizeImage, validateDeclaredUpload, validateImageBytes } from "@/server/imaging/validate";

import { FakeRepository, FakeStorage } from "../support/fakes";
import { makeJpeg, makePng } from "../support/images";

/**
 * Hostile uploads. Every file is judged by its bytes (never the name or
 * declared type), decoded with a pixel limit, and re-encoded so nothing
 * from the original file survives.
 */
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ImageValidationError ? e.code : `threw:${String(e)}`));
const enc = (s: string) => new TextEncoder().encode(s);

/** A valid PNG header claiming huge dimensions, with a tiny compressed body (decompression bomb). */
function pngBomb(width: number, height: number): Uint8Array {
  const crc32 = (buf: Uint8Array) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(enc(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const idat = deflateSync(new Uint8Array(1024 * 64)); // far less data than the header claims
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

describe("malicious uploads", () => {
  it("rejects scripts, SVG, HTML, PDF, GIF, TIFF and HEIC whatever their name says", async () => {
    const files: [string, Uint8Array][] = [
      ["svg with script", enc(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)],
      ["html", enc("<!doctype html><script>fetch('/api/credits')</script>")],
      ["pdf", enc("%PDF-1.7\n1 0 obj<<>>endobj")],
      ["gif", enc("GIF89a\x01\x00\x01\x00\x00\x00\x00;")],
      ["tiff", new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])],
      ["heic", new Uint8Array([0, 0, 0, 0x18, ...enc("ftypheic")])],
      ["elf binary", new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
    ];
    for (const [name, bytes] of files) expect(await codeOf(validateImageBytes(bytes, "image/jpeg")), name).toBe("unsupported_type");
  });

  it("rejects a file with a JPEG signature but garbage after it", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...enc("not really a jpeg at all").slice(0), ...new Uint8Array(2000)]);
    expect(await codeOf(validateImageBytes(fake, "image/jpeg"))).toBe("unreadable");
  });

  it("rejects a truncated JPEG", async () => {
    const jpeg = await makeJpeg(1200, 1200);
    expect(["unreadable", "ok"]).toContain(await codeOf(validateImageBytes(jpeg.subarray(0, 300), "image/jpeg")));
    // Even if metadata parses, sanitising a truncated file must fail rather than store garbage.
    await expect(sanitizeImage(jpeg.subarray(0, 300))).rejects.toBeTruthy();
  });

  it("refuses decompression bombs quickly, without decoding them", async () => {
    const bomb = pngBomb(30_000, 30_000); // 900 megapixels claimed, ~100 bytes compressed per row
    expect(bomb.byteLength).toBeLessThan(200_000);
    const started = Date.now();
    expect(await codeOf(validateImageBytes(bomb, "image/png"))).toMatch(/too_many_pixels|unreadable/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("strips anything appended after the image (polyglot JPEG + HTML)", async () => {
    const jpeg = await makeJpeg(1200, 1200, true);
    const payload = enc("<html><script>steal()</script></html>");
    const polyglot = new Uint8Array(jpeg.length + payload.length);
    polyglot.set(jpeg);
    polyglot.set(payload, jpeg.length);
    await validateImageBytes(polyglot, "image/jpeg");
    const clean = await sanitizeImage(polyglot);
    expect(Buffer.from(clean.bytes).includes(Buffer.from("<script>"))).toBe(false);
    expect(Buffer.from(clean.bytes).includes(Buffer.from("Exif"))).toBe(false);
  });

  it("rejects declared types and names outside the allow-list before issuing an upload URL", () => {
    const bad = [
      { fileName: "x.svg", mimeType: "image/svg+xml", sizeBytes: 10 },
      { fileName: "x.jpg", mimeType: "text/html", sizeBytes: 10 },
      { fileName: "x.php", mimeType: "image/jpeg", sizeBytes: 10 },
      { fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 },
      { fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 0 },
    ];
    for (const b of bad) expect(() => validateDeclaredUpload(b), b.fileName + b.mimeType).toThrow(ImageValidationError);
  });

  it("never uses the client's file name in storage paths (no path traversal)", async () => {
    const repo = new FakeRepository();
    const storage = new FakeStorage();
    const deps: GenerationDeps = { repo, storage, provider: null, limits: { maxActiveJobs: 3, dailyLimit: 200 } };
    const userId = randomUUID();
    const shopId = repo.addShop(userId, 10);
    const signed = await signUpload(deps, userId, { fileName: "../../other-shop/../../etc/passwd.jpg", mimeType: "image/jpeg", sizeBytes: 50_000 });
    expect(signed.path).toMatch(new RegExp(`^${shopId}/[0-9a-f-]{36}/upload\\.jpg$`));

    // And a file swapped for something else after signing is still rejected on completion.
    storage.put(BUCKETS.originals, signed.path, enc("<svg onload=alert(1)>"));
    await expect(completeUpload(deps, userId, signed.sourceImageId)).rejects.toMatchObject({ code: "invalid_file" });
    expect(storage.objects.has(storage.key(BUCKETS.originals, signed.path))).toBe(false); // the raw upload is deleted
  });

  it("does not let one shop complete another shop's upload", async () => {
    const repo = new FakeRepository();
    const storage = new FakeStorage();
    const deps: GenerationDeps = { repo, storage, provider: null, limits: { maxActiveJobs: 3, dailyLimit: 200 } };
    const a = randomUUID();
    repo.addShop(a, 10);
    const b = randomUUID();
    repo.addShop(b, 10);
    const signed = await signUpload(deps, a, { fileName: "ring.png", mimeType: "image/png", sizeBytes: 50_000 });
    storage.put(BUCKETS.originals, signed.path, await makePng(1200, 1200));
    await expect(completeUpload(deps, b, signed.sourceImageId)).rejects.toMatchObject({ status: 404 });
  });
});

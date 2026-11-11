import sharp, { type Sharp } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { UPLOAD_LIMITS } from "@/lib/upload-limits";
import { ImageHeaderError, orientedSize, readImageHeader, sniffFormat } from "@/server/imaging/header";
import { cloudflareImagesProcessor, ImageProcessingError, type ImagesBindingLike, sharpProcessor } from "@/server/imaging/processor";
import { ImageValidationError, sanitizeImage, validateImageBytes } from "@/server/imaging/validate";

/**
 * The header reader replaces sharp.metadata() everywhere (it must run on
 * Cloudflare Workers), so it's checked against files sharp itself writes.
 */

const W = 40;
const H = 24;
const rgb = () => sharp({ create: { width: W, height: H, channels: 3, background: { r: 200, g: 150, b: 60 } } });
const rgba = () => sharp({ create: { width: W, height: H, channels: 4, background: { r: 200, g: 150, b: 60, alpha: 0.5 } } });
const bytes = async (s: Sharp) => new Uint8Array(await s.toBuffer());

/** A PNG whose IHDR claims width × height, with no pixel data at all. */
function fakePngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[24] = 8; // bit depth
  b[25] = 2; // RGB
  return b;
}

describe("image header reader", () => {
  const files: Record<string, Uint8Array> = {};
  beforeAll(async () => {
    files.jpeg = await bytes(rgb().jpeg());
    files.jpegProgressive = await bytes(rgb().jpeg({ progressive: true }));
    files.png = await bytes(rgb().png());
    files.pngAlpha = await bytes(rgba().png());
    files.pngGreyAlpha = await bytes(rgba().greyscale().png());
    files.pngPaletteTransparent = await bytes(rgba().png({ palette: true }));
    files.webpLossy = await bytes(rgb().webp());
    files.webpLossless = await bytes(rgba().webp({ lossless: true }));
    files.webpLossyAlpha = await bytes(rgba().webp({ quality: 80 }));
    for (let o = 1; o <= 8; o++) files[`jpegOrientation${o}`] = await bytes(rgb().jpeg().withMetadata({ orientation: o }));
    files.webpOrientation6 = await bytes(rgb().webp().withMetadata({ orientation: 6 }));
  });

  it("reads JPEG, PNG and WebP sizes and formats the same way sharp does", async () => {
    for (const [name, b] of Object.entries(files)) {
      const mine = readImageHeader(b);
      const theirs = await sharp(b).metadata();
      expect({ name, format: mine.format, width: mine.width, height: mine.height }).toEqual({
        name,
        format: theirs.format,
        width: theirs.width,
        height: theirs.height,
      });
    }
  });

  it("reads EXIF orientation 1–8 from JPEG, and from WebP", async () => {
    for (let o = 1; o <= 8; o++) {
      const b = files[`jpegOrientation${o}`]!;
      expect(readImageHeader(b).orientation).toBe(o);
      expect(readImageHeader(b).orientation).toBe((await sharp(b).metadata()).orientation ?? 1);
    }
    expect(readImageHeader(files.webpOrientation6!).orientation).toBe(6);
    expect(orientedSize(readImageHeader(files.jpegOrientation6!))).toEqual({ width: H, height: W });
    expect(orientedSize(readImageHeader(files.jpegOrientation3!))).toEqual({ width: W, height: H });
  });

  it("detects alpha channels like sharp does", async () => {
    for (const [name, b] of Object.entries(files)) {
      expect({ name, hasAlpha: readImageHeader(b).hasAlpha }).toEqual({ name, hasAlpha: (await sharp(b).metadata()).hasAlpha });
    }
  });

  it("rejects files that aren't images, or whose header is truncated", () => {
    expect(sniffFormat(new TextEncoder().encode("GIF89a…"))).toBeNull();
    expect(() => readImageHeader(new TextEncoder().encode("<svg></svg>"))).toThrow(ImageHeaderError);
    expect(() => readImageHeader(files.jpeg!.subarray(0, 20))).toThrow(ImageHeaderError);
    expect(() => readImageHeader(files.webpLossy!.subarray(0, 16))).toThrow(ImageHeaderError);
    expect(() => readImageHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrow(ImageHeaderError);
  });

  it("enforces the pixel and dimension limits from the header, before anything is decoded", async () => {
    // 8000 × 8000 = 64 MP: over the 40 MP upload limit. The file has no pixel data, so a decoder would fail differently.
    await expect(validateImageBytes(fakePngHeader(8000, 8000))).rejects.toMatchObject({ code: "too_many_pixels" });
    await expect(validateImageBytes(fakePngHeader(12_500, 100))).rejects.toMatchObject({ code: "too_big_dimensions" });
    await expect(sanitizeImage(fakePngHeader(8000, 8000))).rejects.toBeInstanceOf(ImageValidationError);
    expect(8000 * 8000).toBeGreaterThan(UPLOAD_LIMITS.maxPixels);
  });

  it("validates uploads using the displayed (rotated) size", async () => {
    const v = await validateImageBytes(files.jpegOrientation6!, "image/jpeg");
    expect(v).toEqual({ mimeType: "image/jpeg", width: H, height: W });
  });
});

/**
 * A stand-in for env.IMAGES that behaves like Miniflare's local emulation
 * (which wrangler dev uses): auto-orient, then each transform in order, then
 * the output format.
 */
function fakeImagesBinding(calls: Record<string, unknown>[]): ImagesBindingLike {
  return {
    input(stream) {
      const transforms: Record<string, unknown>[] = [];
      const t = {
        transform(o: Record<string, unknown>) {
          transforms.push(o);
          calls.push(o);
          return t;
        },
        async output(o: { format: string; quality?: number }) {
          let img = sharp(new Uint8Array(await new Response(stream).arrayBuffer()), { autoOrient: true });
          for (const x of transforms) {
            if (x.width !== undefined || x.height !== undefined) {
              const fit = x.fit === "crop" ? "cover" : "inside";
              img = img.resize((x.width as number) ?? null, (x.height as number) ?? null, { fit, withoutEnlargement: true });
            }
            if (typeof x.background === "string") img = img.flatten({ background: x.background });
          }
          img = o.format === "image/png" ? img.png() : img.jpeg({ quality: o.quality });
          const data = await img.toBuffer();
          calls.push({ output: o });
          return { image: () => new Response(new Uint8Array(data)).body!, contentType: () => o.format };
        },
      };
      return t;
    },
  };
}

describe("image processors", () => {
  let portraitExif: Uint8Array;
  let alphaPng: Uint8Array;
  beforeAll(async () => {
    // Stored 300×200 with orientation 6, so it displays as 200×300.
    portraitExif = new Uint8Array(
      await sharp({ create: { width: 300, height: 200, channels: 3, background: "#c89632" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    );
    alphaPng = new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
  });

  for (const [name, make] of [
    ["sharp", () => sharpProcessor],
    ["cloudflare-images (fake binding)", () => cloudflareImagesProcessor(fakeImagesBinding([]))],
  ] as const) {
    describe(name, () => {
      it("applies EXIF orientation and drops it from the output", async () => {
        const out = await make().transform(portraitExif, { output: { format: "jpeg", quality: 90 } });
        expect({ w: out.width, h: out.height, format: out.format }).toEqual({ w: 200, h: 300, format: "jpeg" });
        expect(readImageHeader(out.bytes).orientation).toBe(1);
      });

      it("shrinks to fit inside a box without enlarging", async () => {
        const small = await make().transform(portraitExif, { fitInside: { width: 100, height: 100 }, output: { format: "png" } });
        expect({ w: small.width, h: small.height }).toEqual({ w: 67, h: 100 });
        const big = await make().transform(portraitExif, { fitInside: { width: 5000, height: 5000 }, output: { format: "png" } });
        expect({ w: big.width, h: big.height }).toEqual({ w: 200, h: 300 });
      });

      it("crops to an exact centred size", async () => {
        const out = await make().transform(portraitExif, { cropCentre: { width: 200, height: 150 }, output: { format: "png" } });
        expect({ w: out.width, h: out.height, format: readImageHeader(out.bytes).format }).toEqual({ w: 200, h: 150, format: "png" });
      });

      it("keeps alpha in PNG output and flattens it onto white for JPEG", async () => {
        const png = await make().transform(alphaPng, { output: { format: "png" } });
        expect(readImageHeader(png.bytes).hasAlpha).toBe(true);
        const jpg = await make().transform(alphaPng, { background: "#ffffff", output: { format: "jpeg", quality: 90 } });
        const { data } = await sharp(jpg.bytes).raw().toBuffer({ resolveWithObject: true });
        expect(Math.min(data[0]!, data[1]!, data[2]!)).toBeGreaterThan(245); // white, not black
      });
    });
  }

  it("sends the binding the expected operations", async () => {
    const calls: Record<string, unknown>[] = [];
    await cloudflareImagesProcessor(fakeImagesBinding(calls)).transform(portraitExif, {
      cropCentre: { width: 200, height: 150 },
      background: "#ffffff",
      output: { format: "jpeg", quality: 88 },
    });
    expect(calls).toEqual([
      { width: 200, height: 150, fit: "crop" },
      { background: "#ffffff" },
      { output: { format: "image/jpeg", quality: 88 } },
    ]);
  });

  it("refuses a binding result in a different format than requested", async () => {
    const lying: ImagesBindingLike = {
      input: () => {
        const t = {
          transform: () => t,
          output: async () => ({ image: () => new Response(new Uint8Array([1, 2, 3])).body!, contentType: () => "image/webp" }),
        };
        return t;
      },
    };
    await expect(cloudflareImagesProcessor(lying).transform(portraitExif, { output: { format: "png" } })).rejects.toBeInstanceOf(ImageProcessingError);
  });
});

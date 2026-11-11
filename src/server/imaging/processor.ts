import { getCloudflareContext } from "@opennextjs/cloudflare";

import { type ImageFormat, orientedSize, readImageHeader } from "./header";

/**
 * Pixel operations used by the app, behind one interface:
 *
 * - Node (local dev, `next build`, tests, scripts): sharp, imported only when
 *   first used, so the Cloudflare Worker never loads its native module.
 * - Cloudflare Workers: the Images binding (`IMAGES` in wrangler.jsonc).
 *
 * Every operation applies EXIF orientation first (as sharp's .rotate() did at
 * every call site). Sizes, format, orientation and alpha are read without
 * decoding by ./header.ts, which also enforces pixel limits before this runs.
 */

export interface ImageOps {
  /** Centred crop to exactly this size, in displayed (orientation-applied) pixels. Must fit inside the image. */
  cropCentre?: { width: number; height: number };
  /** Shrink to fit inside this box, keeping the aspect ratio. Never enlarges. */
  fitInside?: { width: number; height: number };
  /** Colour behind transparent pixels when the output has no alpha (JPEG). */
  background?: string;
  output: { format: "jpeg"; quality: number; /** Full-resolution colour (no chroma subsampling) where supported. */ fullChroma?: boolean } | { format: "png" };
}

export interface ProcessedImage {
  bytes: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
}

export interface ImageProcessor {
  readonly name: "sharp" | "cloudflare-images";
  transform(bytes: Uint8Array, ops: ImageOps): Promise<ProcessedImage>;
}

export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** The processor for the current runtime. On Workers, throws if the IMAGES binding is missing. */
export function imageProcessor(): ImageProcessor {
  if (!onWorkers) return sharpProcessor;
  const images = (getCloudflareContext().env as { IMAGES?: ImagesBindingLike }).IMAGES;
  if (!images) throw new ImageProcessingError("The IMAGES binding isn't configured in wrangler.jsonc.");
  return cloudflareImagesProcessor(images);
}

// --------------------------------------------------------------------- sharp

type Sharp = (typeof import("sharp"))["default"];
let sharpModule: Promise<Sharp> | null = null;
const loadSharp = () => (sharpModule ??= import("sharp").then((m) => m.default));

/** Upper bound for sharp itself; callers already check their own (smaller) limits from the header. */
const SHARP_PIXEL_CEILING = 100_000_000;

export const sharpProcessor: ImageProcessor = {
  name: "sharp",
  async transform(bytes, ops) {
    const sharp = await loadSharp();
    let img = sharp(bytes, { limitInputPixels: SHARP_PIXEL_CEILING }).rotate();
    if (ops.cropCentre) {
      const shown = orientedSize(readImageHeader(bytes));
      const { width, height } = ops.cropCentre;
      if (width > shown.width || height > shown.height) throw new ImageProcessingError("crop is larger than the image");
      img = img.extract({ left: Math.floor((shown.width - width) / 2), top: Math.floor((shown.height - height) / 2), width, height });
    }
    if (ops.fitInside) img = img.resize({ ...ops.fitInside, fit: "inside", withoutEnlargement: true });
    if (ops.output.format === "jpeg") {
      img = img.flatten({ background: ops.background ?? "#ffffff" }).jpeg({
        quality: ops.output.quality,
        mozjpeg: true,
        ...(ops.output.fullChroma ? { chromaSubsampling: "4:4:4" } : {}),
      });
    } else {
      img = img.png({ compressionLevel: 9 });
    }
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), format: ops.output.format, width: info.width, height: info.height };
  },
};

// --------------------------------------------------------- Cloudflare Images

/** The subset of the Workers Images binding used here (env.IMAGES). */
export interface ImagesBindingLike {
  input(stream: ReadableStream<Uint8Array>): ImageTransformerLike;
}
interface ImageTransformerLike {
  transform(options: Record<string, unknown>): ImageTransformerLike;
  output(options: { format: string; quality?: number }): Promise<{ image(): ReadableStream<Uint8Array>; contentType(): string }>;
}

export function cloudflareImagesProcessor(images: ImagesBindingLike): ImageProcessor {
  return {
    name: "cloudflare-images",
    async transform(bytes, ops) {
      // Copy into a plain ArrayBuffer: the input may be a view into a larger (or shared) buffer.
      let t = images.input(new Response(new Uint8Array(bytes).buffer as ArrayBuffer).body!);
      // EXIF orientation is applied by the binding (as by sharp's autoOrient in local dev).
      if (ops.cropCentre) {
        // The crop box fills one side exactly, so "crop" trims the other side around the centre without scaling.
        t = t.transform({ width: ops.cropCentre.width, height: ops.cropCentre.height, fit: "crop" });
      }
      if (ops.fitInside) t = t.transform({ width: ops.fitInside.width, height: ops.fitInside.height, fit: "scale-down" });
      if (ops.output.format === "jpeg") t = t.transform({ background: ops.background ?? "#ffffff" });

      const mime = `image/${ops.output.format}`;
      const result = await t.output(ops.output.format === "jpeg" ? { format: mime, quality: ops.output.quality } : { format: mime });
      // The binding may fall back to another format; callers rely on the one they asked for.
      if (result.contentType() !== mime) throw new ImageProcessingError(`Images binding returned ${result.contentType()}, not ${mime}`);
      const out = new Uint8Array(await new Response(result.image()).arrayBuffer());
      const header = readImageHeader(out);
      if (header.format !== ops.output.format) throw new ImageProcessingError("Images binding output doesn't match its content type");
      return { bytes: out, format: header.format, width: header.width, height: header.height };
    },
  };
}

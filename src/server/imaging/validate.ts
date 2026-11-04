import { createHash } from "node:crypto";

import sharp from "sharp";

import { UPLOAD_LIMITS, type AcceptedMimeType } from "@/lib/upload-limits";

/**
 * Validation and sanitising for uploaded photos. Works on the actual bytes:
 * the browser-declared type and file extension are never trusted.
 */

export type ImageValidationCode =
  | "too_large"
  | "empty"
  | "unsupported_type"
  | "type_mismatch"
  | "unreadable"
  | "too_big_dimensions"
  | "too_many_pixels";

export class ImageValidationError extends Error {
  constructor(
    readonly code: ImageValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/** Identify JPEG, PNG or WebP from magic bytes. */
export function sniffImageType(bytes: Uint8Array): AcceptedMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Cheap checks on what the browser declares, before issuing an upload URL. */
export function validateDeclaredUpload(input: { mimeType: string; sizeBytes: number; fileName: string }): void {
  if (!(UPLOAD_LIMITS.acceptedMimeTypes as readonly string[]).includes(input.mimeType)) {
    throw new ImageValidationError("unsupported_type", "Upload a JPG, PNG or WebP photo.");
  }
  const lower = input.fileName.toLowerCase();
  if (!UPLOAD_LIMITS.acceptedExtensions.some((ext) => lower.endsWith(ext))) {
    throw new ImageValidationError("unsupported_type", "Upload a JPG, PNG or WebP photo.");
  }
  if (input.sizeBytes <= 0) throw new ImageValidationError("empty", "This file is empty.");
  if (input.sizeBytes > UPLOAD_LIMITS.maxBytes) {
    throw new ImageValidationError("too_large", "Photos must be 25 MB or smaller.");
  }
}

export interface ValidatedImage {
  mimeType: AcceptedMimeType;
  width: number;
  height: number;
}

/** Full validation against the stored bytes. */
export async function validateImageBytes(
  bytes: Uint8Array,
  declaredMimeType?: string,
): Promise<ValidatedImage> {
  if (bytes.byteLength === 0) throw new ImageValidationError("empty", "This file is empty.");
  if (bytes.byteLength > UPLOAD_LIMITS.maxBytes) {
    throw new ImageValidationError("too_large", "Photos must be 25 MB or smaller.");
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new ImageValidationError("unsupported_type", "This file isn't a JPG, PNG or WebP image.");
  if (declaredMimeType && declaredMimeType !== sniffed) {
    throw new ImageValidationError("type_mismatch", "The file's contents don't match its type. Re-export it as JPG or PNG.");
  }

  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(bytes, { limitInputPixels: UPLOAD_LIMITS.maxPixels }).metadata();
    // Respect EXIF orientation when judging dimensions.
    const rotated = (meta.orientation ?? 1) >= 5;
    width = rotated ? meta.height : meta.width;
    height = rotated ? meta.width : meta.height;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/pixel limit/i.test(msg)) {
      throw new ImageValidationError("too_many_pixels", "This photo is too large. Use one under 40 megapixels.");
    }
    throw new ImageValidationError("unreadable", "We couldn't read this image. Try exporting it again.");
  }

  if (!width || !height) throw new ImageValidationError("unreadable", "We couldn't read this image.");
  if (width * height > UPLOAD_LIMITS.maxPixels) {
    throw new ImageValidationError("too_many_pixels", "This photo is too large. Use one under 40 megapixels.");
  }
  if (Math.max(width, height) > UPLOAD_LIMITS.maxDimension) {
    throw new ImageValidationError("too_big_dimensions", "This photo is wider or taller than 12,000px.");
  }

  return { mimeType: sniffed, width, height };
}

export interface SanitizedImage {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  sha256: string;
}

/**
 * Re-encode the photo: applies EXIF rotation, drops all metadata (GPS,
 * camera serials), and discards anything embedded in the original file.
 * PNGs with transparency stay PNG; everything else becomes high-quality JPEG.
 */
export async function sanitizeImage(bytes: Uint8Array): Promise<SanitizedImage> {
  const image = sharp(bytes, { limitInputPixels: UPLOAD_LIMITS.maxPixels }).rotate();
  const meta = await sharp(bytes).metadata();
  const keepPng = meta.format === "png" && meta.hasAlpha === true;

  const out = keepPng
    ? await image.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await image.jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  return {
    bytes: new Uint8Array(out.data),
    mimeType: keepPng ? "image/png" : "image/jpeg",
    width: out.info.width,
    height: out.info.height,
    sha256: createHash("sha256").update(out.data).digest("hex"),
  };
}

/** Choose the provider output size closest to the photo's aspect ratio. */
export function outputSizeFor(width: number, height: number): "1024x1024" | "1536x1024" | "1024x1536" {
  const ratio = width / height;
  if (ratio >= 1.25) return "1536x1024";
  if (ratio <= 0.8) return "1024x1536";
  return "1024x1024";
}

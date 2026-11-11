/**
 * Reads an image's format, size, EXIF orientation and alpha from its header,
 * without decoding pixels. Plain JavaScript, so it runs the same on Node and
 * on Cloudflare Workers (where sharp can't load and the Images binding's
 * info() reports neither orientation nor alpha).
 *
 * Because nothing is decoded, the pixel limit is checked before any image
 * library touches the file.
 *
 * Supported: JPEG (baseline and progressive), PNG, WebP (lossy VP8, lossless
 * VP8L, extended VP8X). Orientation comes from EXIF in JPEG APP1, PNG eXIf
 * and WebP EXIF chunks.
 */

export type ImageFormat = "jpeg" | "png" | "webp";

export interface ImageHeader {
  format: ImageFormat;
  /** Stored (encoded) size, before EXIF orientation is applied. */
  width: number;
  height: number;
  /** EXIF orientation 1–8 (1 = as stored). */
  orientation: number;
  hasAlpha: boolean;
}

export class ImageHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageHeaderError";
  }
}

/** Width and height as displayed: orientations 5–8 swap them. */
export function orientedSize(h: Pick<ImageHeader, "width" | "height" | "orientation">) {
  return h.orientation >= 5 ? { width: h.height, height: h.width } : { width: h.width, height: h.height };
}

export function sniffFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Throws ImageHeaderError if the header is missing, truncated or malformed. */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  const format = sniffFormat(bytes);
  if (!format) throw new ImageHeaderError("not a JPEG, PNG or WebP image");
  const h = format === "jpeg" ? readJpeg(bytes) : format === "png" ? readPng(bytes) : readWebp(bytes);
  if (!(h.width > 0 && h.height > 0)) throw new ImageHeaderError("image has no size");
  return h;
}

// ---------------------------------------------------------------------- JPEG

/** Start-of-frame markers carry the size: C0–CF except C4 (DHT), C8 (JPG) and CC (DAC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function readJpeg(b: Uint8Array): ImageHeader {
  let orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new ImageHeaderError("corrupt JPEG marker");
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan: no frame header found before it
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new ImageHeaderError("truncated JPEG segment");
    const seg = i + 4;
    if (marker === 0xe1 && len >= 8 && ascii(b, seg, 4) === "Exif" && b[seg + 4] === 0 && b[seg + 5] === 0) {
      orientation = exifOrientation(b.subarray(seg + 6, i + 2 + len)) ?? orientation;
    }
    if (isSof(marker)) {
      if (len < 7) throw new ImageHeaderError("truncated JPEG frame header");
      return { format: "jpeg", height: u16be(b, seg + 1), width: u16be(b, seg + 3), orientation, hasAlpha: false };
    }
    i += 2 + len;
  }
  throw new ImageHeaderError("JPEG frame header not found");
}

// ----------------------------------------------------------------------- PNG

function readPng(b: Uint8Array): ImageHeader {
  if (b.length < 33 || ascii(b, 12, 4) !== "IHDR") throw new ImageHeaderError("PNG header missing");
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  const colorType = b[25]!;
  // 4 = grey + alpha, 6 = RGBA. A tRNS chunk adds transparency to the others.
  let hasAlpha = colorType === 4 || colorType === 6;
  let orientation = 1;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) break; // truncated tail: keep what we have
    if (type === "tRNS") hasAlpha = true;
    if (type === "eXIf") orientation = exifOrientation(b.subarray(i + 8, i + 8 + len)) ?? orientation;
    if (type === "IDAT" || type === "IEND") break; // eXIf and tRNS come before image data
    i += 12 + len;
  }
  return { format: "png", width, height, orientation, hasAlpha };
}

// ---------------------------------------------------------------------- WebP

function readWebp(b: Uint8Array): ImageHeader {
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let orientation = 1;
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    const data = i + 8;
    if (data + len > b.length && type !== "VP8 " && type !== "VP8L" && type !== "VP8X") break;
    if (type === "VP8X" && len >= 10) {
      hasAlpha = (b[data]! & 0x10) !== 0;
      width = 1 + u24le(b, data + 4);
      height = 1 + u24le(b, data + 7);
    } else if (type === "VP8 " && len >= 10 && !width) {
      // Frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height.
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) throw new ImageHeaderError("bad VP8 start code");
      width = u16le(b, data + 6) & 0x3fff;
      height = u16le(b, data + 8) & 0x3fff;
    } else if (type === "VP8L" && len >= 5 && !width) {
      if (b[data] !== 0x2f) throw new ImageHeaderError("bad VP8L signature");
      const bits = u32le(b, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasAlpha = ((bits >>> 28) & 1) === 1;
    } else if (type === "ALPH") {
      hasAlpha = true;
    } else if (type === "EXIF") {
      orientation = exifOrientation(b.subarray(data, Math.min(data + len, b.length))) ?? orientation;
    }
    i = data + len + (len & 1); // chunks are padded to an even length
  }
  if (!width || !height) throw new ImageHeaderError("WebP size not found");
  return { format: "webp", width, height, orientation, hasAlpha };
}

// ---------------------------------------------------------------------- EXIF

/** Orientation tag (0x0112) from a TIFF-structured EXIF block, or null. Some writers prefix "Exif\0\0"; that's skipped. */
function exifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length >= 6 && ascii(tiff, 0, 4) === "Exif") tiff = tiff.subarray(6);
  if (tiff.length < 8) return null;
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? u16le(tiff, o) : u16be(tiff, o));
  const u32 = (o: number) => (le ? u32le(tiff, o) : u32be(tiff, o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

// ------------------------------------------------------------------- helpers

function ascii(b: Uint8Array, at: number, len: number): string {
  if (at + len > b.length) return "";
  let s = "";
  for (let k = 0; k < len; k++) s += String.fromCharCode(b[at + k]!);
  return s;
}
const u16be = (b: Uint8Array, o: number) => ((b[o]! << 8) | b[o + 1]!) >>> 0;
const u16le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8)) >>> 0;
const u24le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) >>> 0;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

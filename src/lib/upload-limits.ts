/**
 * Upload limits shared by the browser (early feedback) and the server
 * (enforcement). The server re-checks everything against the actual bytes.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  /** Longest side, in pixels. (There is no minimum: small photos are accepted.) */
  maxDimension: 12_000,
  /** Decompression-bomb guard. */
  maxPixels: 40_000_000,
  acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  acceptedExtensions: [".jpg", ".jpeg", ".png", ".webp"] as const,
} as const;

export type AcceptedMimeType = (typeof UPLOAD_LIMITS.acceptedMimeTypes)[number];

export function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return (UPLOAD_LIMITS.acceptedMimeTypes as readonly string[]).includes(value);
}

export const INSTRUCTIONS_MAX_LENGTH = 400;

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

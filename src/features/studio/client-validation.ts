import { formatMegabytes, isAcceptedMimeType, UPLOAD_LIMITS } from "@/lib/upload-limits";

/**
 * Early, friendly checks in the browser. The server re-validates the real
 * bytes, so these are for feedback only — never for security.
 */
export async function precheckFile(file: File): Promise<string | null> {
  if (!isAcceptedMimeType(file.type)) {
    return file.type === "image/heic" || /\.heic$/i.test(file.name)
      ? "HEIC photos aren't supported yet. On iPhone, set Camera › Formats to “Most Compatible”, or export as JPG."
      : "Upload a JPG, PNG or WebP photo.";
  }
  if (file.size > UPLOAD_LIMITS.maxBytes) {
    return `This photo is ${formatMegabytes(file.size)}. The limit is ${formatMegabytes(UPLOAD_LIMITS.maxBytes)}.`;
  }
  return null;
}

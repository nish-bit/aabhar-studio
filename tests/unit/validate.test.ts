import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ImageValidationError,
  outputSizeFor,
  sanitizeImage,
  sniffImageType,
  validateDeclaredUpload,
  validateImageBytes,
} from "@/server/imaging/validate";

import { makeJpeg, makePng } from "../support/images";

async function code(p: Promise<unknown> | (() => void)): Promise<string> {
  try {
    if (typeof p === "function") p();
    else await p;
  } catch (err) {
    if (err instanceof ImageValidationError) return err.code;
    throw err;
  }
  return "ok";
}

describe("image validation", () => {
  it("sniffs real formats from magic bytes", async () => {
    expect(sniffImageType(await makeJpeg())).toBe("image/jpeg");
    expect(sniffImageType(await makePng())).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("GIF89a...."))).toBeNull();
  });

  it("accepts a normal product photo", async () => {
    await expect(validateImageBytes(await makeJpeg(1600, 1200), "image/jpeg")).resolves.toMatchObject({
      mimeType: "image/jpeg",
      width: 1600,
      height: 1200,
    });
  });

  it("rejects a text file renamed to .jpg", async () => {
    expect(await code(validateImageBytes(new TextEncoder().encode("not really a jpeg"), "image/jpeg"))).toBe("unsupported_type");
  });

  it("rejects a PNG declared as JPEG", async () => {
    expect(await code(validateImageBytes(await makePng(), "image/jpeg"))).toBe("type_mismatch");
  });

  it("accepts small photos (no minimum resolution), e.g. 500×666", async () => {
    await expect(validateImageBytes(await makeJpeg(500, 666), "image/jpeg")).resolves.toMatchObject({ width: 500, height: 666 });
    await expect(validateImageBytes(await makeJpeg(1200, 640), "image/jpeg")).resolves.toMatchObject({ width: 1200, height: 640 });
  });

  it("rejects bad declared uploads before issuing a URL", async () => {
    expect(await code(() => validateDeclaredUpload({ mimeType: "image/gif", sizeBytes: 10, fileName: "a.gif" }))).toBe("unsupported_type");
    expect(await code(() => validateDeclaredUpload({ mimeType: "image/jpeg", sizeBytes: 30 * 1024 * 1024, fileName: "a.jpg" }))).toBe("too_large");
    expect(await code(() => validateDeclaredUpload({ mimeType: "image/jpeg", sizeBytes: 10, fileName: "a.exe" }))).toBe("unsupported_type");
    expect(await code(() => validateDeclaredUpload({ mimeType: "image/jpeg", sizeBytes: 10, fileName: "ring.JPG" }))).toBe("ok");
  });

  it("strips EXIF metadata when sanitising", async () => {
    const withExif = await makeJpeg(1200, 1200, true);
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const clean = await sanitizeImage(withExif);
    expect((await sharp(clean.bytes).metadata()).exif).toBeUndefined();
    expect(clean.mimeType).toBe("image/jpeg");
    expect(clean.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps PNG with transparency as PNG", async () => {
    const clean = await sanitizeImage(await makePng(1024, 1024, true));
    expect(clean.mimeType).toBe("image/png");
  });

  it("picks an output size matching the photo's shape", () => {
    expect(outputSizeFor(1200, 1200)).toBe("1024x1024");
    expect(outputSizeFor(3000, 2000)).toBe("1536x1024");
    expect(outputSizeFor(2000, 3000)).toBe("1024x1536");
  });
});

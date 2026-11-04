import sharp from "sharp";

/** Real encoded test images, generated in memory. */
export async function makeJpeg(width = 1200, height = 1200, withExif = false): Promise<Uint8Array> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 201, g: 164, b: 100 } } }).jpeg({ quality: 80 });
  if (withExif) {
    img = img.withExif({ IFD0: { Make: "TestCam", Model: "SecretSerial123", Copyright: "test" } });
  }
  return new Uint8Array(await img.toBuffer());
}

export async function makePng(width = 1024, height = 1024, alpha = false): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 255, g: 255, b: 255, alpha: 0.5 } : "#ffffff" },
    })
      .png()
      .toBuffer(),
  );
}

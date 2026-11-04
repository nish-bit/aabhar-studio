/**
 * Photo sizes offered in the generator (step 4), shared by the browser and
 * the server.
 *
 * The image model only produces 1024×1024, 1536×1024 (3:2) and 1024×1536
 * (2:3). So each size is generated at its nearest supported frame (with the
 * piece composed inside a safe margin) and then trimmed on the server to the
 * exact ratio. `output` is the real final pixel size, shown to the user.
 */
export const PHOTO_SIZE_IDS = ["3:4", "1:1", "16:9", "9:16"] as const;
export type PhotoSizeId = (typeof PHOTO_SIZE_IDS)[number];

export type ProviderFrame = "1024x1024" | "1536x1024" | "1024x1536";

export interface PhotoSize {
  id: PhotoSizeId;
  name: string;
  orientation: "Portrait" | "Square" | "Landscape" | "Vertical";
  uses: string;
  /** Ratio as width:height numbers. */
  w: number;
  h: number;
  /** Frame requested from the image model. */
  frame: ProviderFrame;
  /** Final pixel size after trimming to the exact ratio. */
  output: { width: number; height: number };
}

export const PHOTO_SIZES: PhotoSize[] = [
  { id: "3:4", name: "Catalogue", orientation: "Portrait", uses: "Catalogues, e-commerce listings and product pages", w: 3, h: 4, frame: "1024x1536", output: { width: 1024, height: 1365 } },
  { id: "1:1", name: "Instagram", orientation: "Square", uses: "Instagram posts, product grids and social media", w: 1, h: 1, frame: "1024x1024", output: { width: 1024, height: 1024 } },
  { id: "16:9", name: "Lookbook", orientation: "Landscape", uses: "Lookbooks, banners, website headers and promotions", w: 16, h: 9, frame: "1536x1024", output: { width: 1536, height: 864 } },
  { id: "9:16", name: "Story", orientation: "Vertical", uses: "Instagram Stories, WhatsApp Status and YouTube Shorts", w: 9, h: 16, frame: "1024x1536", output: { width: 864, height: 1536 } },
];

export const isPhotoSize = (v: unknown): v is PhotoSizeId => typeof v === "string" && (PHOTO_SIZE_IDS as readonly string[]).includes(v);

export const photoSizeById = (id: PhotoSizeId) => PHOTO_SIZES.find((s) => s.id === id)!;

/** Largest centred crop of a width×height image with the size's exact ratio. */
export function cropBoxFor(size: PhotoSize, width: number, height: number) {
  const target = size.w / size.h;
  if (Math.abs(width / height - target) < 0.001) return { left: 0, top: 0, width, height };
  if (width / height > target) {
    const w = Math.round(height * target);
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  const h = Math.round(width / target);
  return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
}

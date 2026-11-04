/**
 * Step 1 of the generator: what kind of piece is being photographed.
 *
 * Card images are SAMPLE photos supplied by the product owner (not AI
 * output, not customer data). Confirm usage rights for each before launch.
 * Maang Teeka reuses the existing owner-supplied demo photo.
 */
export const JEWELLERY_TYPE_IDS = [
  "jewellery_set",
  "bracelet",
  "earring",
  "ring",
  "bangles",
  "necklace",
  "pendant",
  "payal",
  "maang_teeka",
] as const;

export type JewelleryTypeId = (typeof JEWELLERY_TYPE_IDS)[number];

export interface JewelleryType {
  id: JewelleryTypeId;
  name: string;
  description: string;
  image: { src: string; alt: string };
}

export const JEWELLERY_TYPES: JewelleryType[] = [
  { id: "jewellery_set", name: "Jewellery Set", description: "Necklace & Tops together", image: { src: "/jewellery-types/jewellery-set.webp", alt: "Gold necklace with matching drop earrings on red velvet" } },
  { id: "bracelet", name: "Bracelet", description: "Wrist jewellery", image: { src: "/jewellery-types/bracelet.webp", alt: "Fine rose-gold infinity bracelet worn on the wrist" } },
  { id: "earring", name: "Earring", description: "Single or Pair", image: { src: "/jewellery-types/earring.webp", alt: "Pair of gold swirl stud earrings with small stones" } },
  { id: "ring", name: "Ring", description: "Finger jewellery", image: { src: "/jewellery-types/ring.webp", alt: "Silver ring with a triangular solitaire on white paper" } },
  { id: "bangles", name: "Bangles", description: "Stack or Single", image: { src: "/jewellery-types/bangles.webp", alt: "Stack of engraved gold bangles on a black reflective surface" } },
  { id: "necklace", name: "Necklace", description: "Solo necklace", image: { src: "/jewellery-types/necklace.webp", alt: "Rose-gold clover necklace worn with a white collar" } },
  { id: "pendant", name: "Pendant", description: "Neckpiece Charm", image: { src: "/jewellery-types/pendant.webp", alt: "Round diamond cluster pendant on a rose-gold chain" } },
  { id: "payal", name: "Payal", description: "Ankle jewellery", image: { src: "/jewellery-types/payal.webp", alt: "Silver payal with small bells worn on the ankle" } },
  { id: "maang_teeka", name: "Maang Teeka", description: "Forehead jewellery", image: { src: "/demo/tikka-studio.webp", alt: "Antique gold maang teeka with a floral medallion and pearl drops" } },
];

export const isJewelleryType = (v: unknown): v is JewelleryTypeId =>
  typeof v === "string" && (JEWELLERY_TYPE_IDS as readonly string[]).includes(v);

export const jewelleryTypeById = (id: JewelleryTypeId) => JEWELLERY_TYPES.find((t) => t.id === id)!;

export const GENERATOR_STEPS = ["Jewellery Type", "Upload Photo", "Choose Style", "Photo Size", "Generate Image"] as const;

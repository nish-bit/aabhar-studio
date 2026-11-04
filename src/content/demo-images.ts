import type { BeforeAfterPair, DemoImage } from "@/types/content";

/**
 * DEMO IMAGERY — not customer data and not AI output.
 *
 * - "unsplash": free under the Unsplash licence (credit shown).
 * - "user-supplied": sample photos provided by the product owner.
 *   Confirm usage rights before publishing.
 * - "simulated": a studio photo deliberately degraded by
 *   scripts/prepare-demo-images.mjs to stand in for a phone photo.
 *
 * Replace the before/after pairs with real, consented customer
 * before/after images before launch.
 */
const img = (image: DemoImage): DemoImage => image;

export const demoImages = {
  tikkaStudio: img({
    id: "tikka-studio",
    src: "/demo/tikka-studio.webp",
    alt: "Antique gold maang tikka with a floral medallion and pearl drops on a white background",
    width: 1400,
    height: 1400,
    provenance: "user-supplied",
  }),
  tikkaBefore: img({
    id: "tikka-simulated-before",
    src: "/demo/tikka-studio-simulated-before.webp",
    alt: "The same maang tikka in dim, flat light with a soft focus, as a typical phone photo might look",
    width: 1400,
    height: 1400,
    provenance: "simulated",
  }),
  ringDark: img({
    id: "ring-diamond-dark",
    src: "/demo/ring-diamond-dark.webp",
    alt: "Rose gold cocktail ring with a cluster of round diamonds on a charcoal background",
    width: 1400,
    height: 1400,
    provenance: "user-supplied",
  }),
  ringBefore: img({
    id: "ring-simulated-before",
    src: "/demo/ring-diamond-dark-simulated-before.webp",
    alt: "The same diamond ring photographed in dull light with low contrast",
    width: 1400,
    height: 1400,
    provenance: "simulated",
  }),
  necklaceSilver: img({
    id: "necklace-silver-display",
    src: "/demo/necklace-silver-display.webp",
    alt: "Silver ghungroo necklace with enamel accents on a black display bust in a showroom",
    width: 1400,
    height: 1400,
    provenance: "user-supplied",
  }),
  bridalBracelet: img({
    id: "bridal-bracelet",
    src: "/demo/bridal-bracelet.webp",
    alt: "Bride in a red lehenga with mehndi wearing a gold link bracelet, kundan choker and nath",
    width: 1024,
    height: 1024,
    provenance: "user-supplied",
  }),
  bangles: img({
    id: "bangles-model",
    src: "/demo/bangles-model.webp",
    alt: "Pair of gold temple bangles with ruby accents on a wrist",
    width: 1400,
    height: 1400,
    provenance: "user-supplied",
  }),
  anklets: img({
    id: "anklets-satin",
    src: "/demo/anklets-satin.webp",
    alt: "Silver payal anklets with bell charms on satin fabric",
    width: 1344,
    height: 768,
    provenance: "user-supplied",
  }),
  earrings: img({
    id: "earrings-model",
    src: "/demo/earrings-model.webp",
    alt: "Gold chandbali drop earring with ruby and white stones, worn",
    width: 1024,
    height: 1024,
    provenance: "user-supplied",
  }),
  braceletModel: img({
    id: "bracelet-model",
    src: "/demo/bracelet-model.webp",
    alt: "Textured gold link bracelet with an S-hook clasp on a wrist",
    width: 1400,
    height: 1400,
    provenance: "user-supplied",
  }),
  ringInfinity: img({
    id: "ring-infinity-model",
    src: "/demo/ring-infinity-model.webp",
    alt: "Gold infinity ring set with small stones, worn on a hand resting under the chin",
    width: 1024,
    height: 1024,
    provenance: "user-supplied",
  }),
  necklacePearl: img({
    id: "necklace-pearl-flower",
    src: "/demo/necklace-pearl-flower.webp",
    alt: "Gold chain with a flower pendant of baroque pearl petals, emerald stamens and a citrine centre, on black velvet",
    width: 1600,
    height: 2398,
    provenance: "unsplash",
    credit: "Hosniye Sadeghi on Unsplash",
  }),
  ringBox: img({
    id: "ring-box",
    src: "/demo/ring-box.webp",
    alt: "Two-tone diamond engagement ring in an open green presentation box",
    width: 1600,
    height: 1066,
    provenance: "unsplash",
    credit: "Jackie Tsang on Unsplash",
  }),
  layeredGold: img({
    id: "layered-gold",
    src: "/demo/layered-gold.webp",
    alt: "Layered fine gold necklaces, stacked rings and an open cuff worn with a white shirt",
    width: 1600,
    height: 1280,
    provenance: "unsplash",
    credit: "Segal Jewelry on Unsplash",
  }),
} satisfies Record<string, DemoImage>;

const SIMULATED_NOTE =
  "Demo pair. The “before” was simulated by dimming and softening a studio photo — it is not an AI result.";

export const heroPair: BeforeAfterPair = {
  id: "hero-tikka",
  before: demoImages.tikkaBefore,
  after: demoImages.tikkaStudio,
  caption: "Maang tikka · Classic White",
  isDemo: true,
  demoNote: SIMULATED_NOTE,
};

export const ringPair: BeforeAfterPair = {
  id: "ring-charcoal",
  before: demoImages.ringBefore,
  after: demoImages.ringDark,
  caption: "Diamond ring · Velvet Black",
  isDemo: true,
  demoNote: SIMULATED_NOTE,
};

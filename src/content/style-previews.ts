/**
 * Jewellery style preview gallery (/styles). The photos are hosted on
 * gehnaphoto.com (allowed in next.config.ts images.remotePatterns) and
 * served through the Next.js image optimizer. Add or reorder previews here;
 * the page, filters and lightbox follow this list.
 */

export const STYLE_CATEGORIES = [
  { id: "all", label: "All Styles" },
  { id: "ring", label: "Rings" },
  { id: "earring", label: "Earrings" },
  { id: "bracelet", label: "Bracelets & Bangles" },
  { id: "payal", label: "Payal" },
  { id: "maang-tikka", label: "Maan Tika" },
  { id: "pendant", label: "Pendant" },
  { id: "set", label: "Jewellery Sets" },
] as const;

export type StyleCategoryId = Exclude<(typeof STYLE_CATEGORIES)[number]["id"], "all">;

export interface StylePreview {
  id: string;
  name: string;
  category: StyleCategoryId;
  src: string;
  alt: string;
}

const base = "https://gehnaphoto.com/assets/style_previews";

export const STYLE_PREVIEWS: StylePreview[] = [
  { id: "set-macro", name: "Jewellery Set Macro", category: "set", src: `${base}/jewellery_set/macro/preview.jpg`, alt: "Jewellery set photographed in a close macro style" },
  { id: "payal-flatlay", name: "Payal Flatlay", category: "payal", src: `${base}/payal/flatlay/preview.jpg`, alt: "Payal anklet arranged flat and photographed from above" },
  { id: "ring-studio", name: "Ring Studio", category: "ring", src: `${base}/ring/studio/preview.jpg`, alt: "Ring photographed in a clean studio style" },
  { id: "payal-shop-display", name: "Payal Shop Display", category: "payal", src: `${base}/payal/shop_display/preview.jpg`, alt: "Payal anklet presented on a shop display" },
  { id: "tikka-bridal", name: "Maan Tika Indian Bridal", category: "maang-tikka", src: `${base}/maan_tika/indian_bridal/preview.jpg`, alt: "Maang tikka styled in an Indian bridal look" },
  { id: "bangle-modern-wear", name: "Bracelet Bangle Modern Wear", category: "bracelet", src: `${base}/bracelet_bangle/modern_wear/preview.jpg`, alt: "Bracelet bangle worn in a modern everyday look" },
  { id: "bracelet-closeup", name: "Bracelet Closeup", category: "bracelet", src: `${base}/bracelet/closeup/preview.jpg`, alt: "Close-up photograph of a bracelet" },
  { id: "ring-flatlay", name: "Ring Flatlay", category: "ring", src: `${base}/ring/flatlay/preview.jpg`, alt: "Ring arranged flat and photographed from above" },
  { id: "tikka-studio", name: "Maan Tika Studio", category: "maang-tikka", src: `${base}/maan_tika/studio/preview.jpg`, alt: "Maang tikka photographed in a clean studio style" },
  { id: "pendant-macro", name: "Pendant Macro", category: "pendant", src: `${base}/pendant/macro/preview.jpg`, alt: "Pendant photographed in a close macro style" },
  { id: "bracelet-macro", name: "Bracelet Macro", category: "bracelet", src: `${base}/bracelet/macro/preview.jpg`, alt: "Bracelet photographed in a close macro style" },
  { id: "bracelet-bridal", name: "Bracelet Indian Bridal", category: "bracelet", src: `${base}/bracelet/indian_bridal/preview.jpg`, alt: "Bracelet styled in an Indian bridal look" },
  { id: "ring-shop-display", name: "Ring Shop Display", category: "ring", src: `${base}/ring/shop_display/preview.jpg`, alt: "Ring presented on a shop display" },
  { id: "ring-macro", name: "Ring Macro", category: "ring", src: `${base}/ring/macro/preview.jpg`, alt: "Ring photographed in a close macro style" },
  { id: "earring-bridal", name: "Earring Indian Bridal", category: "earring", src: `${base}/earring/indian_bridal/preview.jpg`, alt: "Earrings styled in an Indian bridal look" },
  { id: "earring-modern-wear", name: "Earring Modern Wear", category: "earring", src: `${base}/earring/modern_wear/preview.jpg`, alt: "Earrings worn in a modern everyday look" },
];

export const styleCategoryLabel = (id: StyleCategoryId) => STYLE_CATEGORIES.find((c) => c.id === id)!.label;

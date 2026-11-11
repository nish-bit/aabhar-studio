import { demoImages } from "@/content/demo-images";
import { JEWELLERY_TYPES } from "@/lib/jewellery-types";
import { PHOTO_SIZES } from "@/lib/photo-sizes";
import { PRESET_SLUGS, PRESETS, type PresetSlug } from "@/lib/presets";
import type { DemoImage, FaqItem, FeatureStep, NavLink, Segment, StylePreset } from "@/types/content";

/**
 * Marketing copy for the homepage. Plain data so it can move to a CMS later.
 * No customer counts, testimonials or performance claims are included:
 * those must come from real data before launch.
 */

export const brand = {
  name: "Aabhar Studio",
  /** Placeholder brand name pending decision. */
  isPlaceholderName: true,
  tagline: "AI jewellery photography and catalogues",
  /**
   * Dashboard help links. Aabhar Studio's own WhatsApp number (digits with
   * country code, e.g. "91XXXXXXXXXX") and tutorial video URL. Each card
   * stays hidden while its value is null.
   */
  supportWhatsApp: "917060734295" as string | null,
  /** The WhatsApp number as people see it. */
  supportWhatsAppDisplay: "7060734295",
  supportEmail: "aabharstudio@gmail.com",
  tutorialVideoUrl: null as string | null,
};

export const primaryNav: NavLink[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Styles", href: "/#presets-title" },
  { label: "Style gallery", href: "/styles" },
  { label: "Pricing", href: "/pricing" },
];

export const solutionsNav: NavLink[] = [
  { label: "Retail jewellers", href: "/#segment-retailers", description: "Festive and everyday photos for your counter and WhatsApp" },
  { label: "Wholesalers", href: "/#segment-wholesalers", description: "Hundreds of SKUs, one consistent look" },
  { label: "Jewellery brands", href: "/#segment-brands", description: "Editorial scenes for drops and ads" },
  { label: "Marketplace sellers", href: "/#segment-marketplace", description: "Listing-ready images for Amazon, Flipkart and Myntra" },
];

export const heroContent = {
  overline: "AI jewellery photography",
  title: "Studio photographs from the photos you already take",
  subtitle:
    "Upload a phone photo of one piece, choose a studio look, and check the result side by side with your original. Then build a print-ready catalogue from the images you approve.",
  primaryCta: { label: "Create your first image", href: "/login" },
  secondaryCta: { label: "Explore the styles", href: "/#presets-title" },
  trustLine: "No card needed · Your designs stay private",
};

export const builtFor: string[] = [
  "Gold and polki",
  "Diamond",
  "Kundan and temple",
  "Silver",
  "Bridal sets",
  "Imitation and fashion",
];

export const steps: FeatureStep[] = [
  {
    number: "01",
    title: "Upload",
    body: "Upload a phone photo of one piece — JPG, PNG or WebP. We check the file type, size and resolution before you spend a credit.",
    image: demoImages.ringBefore,
  },
  {
    number: "02",
    title: "Choose a look",
    body: "Pick one of six studio styles, from pure white to black velvet. The credit cost is shown before you generate.",
    image: demoImages.ringDark,
  },
  {
    number: "03",
    title: "Approve and share",
    body: "Compare the result with your original side by side, approve what's right, then download it or add it to a catalogue.",
    image: demoImages.necklacePearl,
  },
];

/**
 * The homepage style cards come from the real preset list (src/lib/presets.ts),
 * so names, descriptions and credit costs always match the studio. Photos are
 * mood references, not results (the section says so); presets without an
 * honest reference photo show their colour swatch instead.
 */
const presetReference: Partial<Record<PresetSlug, DemoImage>> = {
  "white-studio": demoImages.tikkaStudio,
  "black-luxury": demoImages.ringDark,
  velvet: demoImages.necklacePearl,
  editorial: demoImages.ringBox,
};

const presetBestFor: Record<PresetSlug, string[]> = {
  "white-studio": ["Marketplaces", "Price lists"],
  "warm-ivory": ["Gold", "Bridal"],
  "black-luxury": ["Diamond", "Polki"],
  velvet: ["Pendants", "Sets"],
  marble: ["Silver", "Everyday wear"],
  editorial: ["Social posts", "Launches"],
};

export const presets: StylePreset[] = PRESET_SLUGS.map((slug) => ({
  slug,
  name: PRESETS[slug].name,
  description: PRESETS[slug].description,
  creditCost: PRESETS[slug].creditCost,
  bestFor: presetBestFor[slug],
  image: presetReference[slug],
  swatch: PRESETS[slug].swatch,
}));

export interface CategoryShowcaseItem {
  id: string;
  label: string;
  images: DemoImage[];
}

export const categoryShowcase: CategoryShowcaseItem[] = [
  { id: "rings", label: "Rings", images: [demoImages.ringDark, demoImages.ringBox, demoImages.ringInfinity] },
  { id: "necklaces", label: "Necklaces", images: [demoImages.necklacePearl, demoImages.necklaceSilver, demoImages.layeredGold] },
  { id: "bangles", label: "Bangles and bracelets", images: [demoImages.bangles, demoImages.braceletModel, demoImages.bridalBracelet] },
  { id: "bridal", label: "Bridal and festive", images: [demoImages.bridalBracelet, demoImages.tikkaStudio, demoImages.earrings] },
  { id: "silver", label: "Silver", images: [demoImages.anklets, demoImages.necklaceSilver, demoImages.ringBox] },
];

export const catalogueFeature = {
  overline: "Catalogue builder",
  title: "A whole collection, one consistent catalogue",
  body: "Approved images go straight into a print-ready A4 PDF with your logo and contact details, plus the product details you type in: name, SKU, price and specifications.",
  points: [
    "Grid and editorial layouts, portrait or landscape",
    "Show prices, hide them, or use your own wording",
    "Cover and contact pages with your logo",
    "Download a print PDF or a ZIP of the images",
  ],
  cta: { label: "Explore catalogues", href: "/#catalogues" },
};

export const segments: Segment[] = [
  {
    id: "retailers",
    title: "Retail jewellers",
    body: "Clean, consistent photos for your counter, Instagram and WhatsApp, from the phone you already have.",
    href: "/pricing",
    points: ["Shoot on your phone", "Six studio styles", "Download and post"],
  },
  {
    id: "wholesalers",
    title: "Wholesalers",
    body: "One look across your range, and catalogues your trade buyers can browse.",
    href: "/pricing",
    points: ["Same style on every piece", "Catalogues with SKUs", "Hide prices for trade copies"],
  },
  {
    id: "brands",
    title: "Jewellery brands",
    body: "Editorial still-life looks for product drops, without booking a studio each time.",
    href: "/pricing",
    points: ["Editorial and marble styles", "Your logo on catalogues", "Print-ready A4 PDFs"],
  },
  {
    id: "marketplace",
    title: "Marketplace sellers",
    body: "Clean white-background product images for your listings.",
    href: "/pricing",
    points: ["Pure white background", "Your piece's proportions kept", "Full-size download"],
  },
];

export const faqs: FaqItem[] = [
  {
    question: "Will the AI change how my jewellery looks?",
    answer:
      "It shouldn't, but AI edits can sometimes alter details. The image service is told to keep your piece unchanged, and every result is shown next to your original so you can check stones, metal colour, engraving and proportions before you approve it. Discard anything that isn't right.",
  },
  {
    question: "What kind of photo should I upload?",
    answer:
      "A sharp phone photo in daylight, one piece per photo, filling most of the frame. A plain cloth or paper underneath helps. We check the file type, size and resolution before you spend a credit.",
  },
  {
    question: "Who owns the images?",
    answer:
      "You do. Your photos and results are stored privately for your account only and are never shown publicly. You decide where to post the images you download.",
  },
  {
    question: "How do credits work?",
    answer:
      "Most looks use 1 credit per image; scene looks use 2. The cost is shown before you generate. If an image fails, its credits are returned automatically.",
  },
  {
    question: "Do you provide GST invoices?",
    answer: "Yes. Add your GSTIN in billing settings and every invoice will include it.",
  },
  {
    question: "Can I make a catalogue for wholesale buyers?",
    answer:
      "Yes. Build one catalogue and export a retail version with prices and a wholesale version with prices hidden or replaced with “Price on request”.",
  },
];

export const footerColumns: { title: string; links: NavLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Pricing", href: "/pricing" },
      { label: "Styles", href: "/#presets-title" },
      { label: "Catalogues", href: "/#catalogues" },
    ],
  },
  { title: "Solutions", links: solutionsNav.map(({ label, href }) => ({ label, href })) },
  {
    title: "Company",
    links: [
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      { label: "Refunds", href: "/legal/refunds" },
    ],
  },
];

/**
 * DEMO DATA — sample products for the illustrative catalogue spread.
 * Product names and SKUs are sample text for display only (no weights, purity or prices are shown).
 */
export const catalogueSample = {
  cover: {
    title: "Dhanteras Collection",
    subtitle: "Sample catalogue · 2026",
    image: demoImages.necklacePearl,
  },
  items: [
    { image: demoImages.tikkaStudio, name: "Padma maang tikka", sku: "MT-1042" },
    { image: demoImages.ringDark, name: "Surya diamond ring", sku: "RG-2207" },
    { image: demoImages.bangles, name: "Temple bangle pair", sku: "BG-0915" },
    { image: demoImages.earrings, name: "Chandbali drops", sku: "ER-3318" },
  ],
};

export const finalCta = {
  title: "Photograph your next collection this afternoon",
  body: "Start with free trial credits. Bring a few pieces, a phone and good daylight.",
  cta: { label: "Try it free", href: "/login" },
};

export const demoNoticeMessage =
  "Preview build — sample photographs, demo catalogue data and indicative pricing. No images are generated on this page.";

/**
 * "What is Aabhar Studio?" — a short, plain answer near the top of the
 * homepage for people and search/answer engines. Every statement matches
 * what the app does today (presets, catalogue builder, billing).
 */
export const productSummary = {
  title: "What is Aabhar Studio?",
  answer:
    "Aabhar Studio is a web app for jewellers that turns a phone photo of a piece into a studio-style product image using AI, then builds print-ready PDF catalogues from the images you approve.",
  problem:
    "Studio shoots are slow and costly to repeat for every new piece. Aabhar Studio lets you photograph on the phone you already have and get one consistent look across your range.",
  audience: [
    { label: "Retail jewellers", href: "/#segment-retailers" },
    { label: "Wholesalers", href: "/#segment-wholesalers" },
    { label: "Jewellery brands", href: "/#segment-brands" },
    { label: "Marketplace sellers", href: "/#segment-marketplace" },
  ],
  features: [
    "Upload a JPG, PNG or WebP photo of one piece",
    "Choose one of six studio looks, from White Studio to Editorial",
    "Pick an image size for catalogues, Instagram posts, banners or Stories",
    "Compare each result with your original before you approve it",
    "Download images, or build an A4 PDF catalogue with your logo, SKUs and prices",
    "Retail and wholesale versions of a catalogue, with prices shown or hidden",
  ],
};

/** "a, b and c" */
const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Direct answers to the questions people ask before signing up, followed by the product FAQs. */
export function homeFaqs(trialCredits: number): FaqItem[] {
  const images = `${trialCredits} free AI jewellery ${trialCredits === 1 ? "image" : "images"}`;
  return [
    { question: "What is Aabhar Studio?", answer: productSummary.answer },
    {
      question: "Who is Aabhar Studio for?",
      answer:
        "Retail jewellers, wholesalers, jewellery brands and marketplace sellers who need clean, consistent product photos and catalogues without booking a studio for every piece.",
    },
    {
      question: "How does Aabhar Studio work?",
      answer:
        "Sign in, pick the type of piece, upload a phone photo of it, choose a studio look and an image size, then generate. Compare the result with your original side by side, approve the images you're happy with, and download them or add them to a catalogue.",
    },
    {
      question: "What jewellery can I photograph?",
      answer: `The Studio has a setting for each of these: ${listOf(JEWELLERY_TYPES.map((t) => t.name.toLowerCase()))}. Upload one piece, or one set, per photo.`,
    },
    {
      question: "What image sizes can I download?",
      answer: `You choose one of ${PHOTO_SIZES.length} sizes before you generate: ${PHOTO_SIZES.map((p) => `${p.name}, ${p.orientation.toLowerCase()} ${p.output.width}×${p.output.height} px (${p.uses})`).join("; ")}.`,
    },
    {
      question: "Is there a free plan?",
      answer: `There's a free trial: every new account gets ${images}. After that you buy credits as you need them.`,
    },
    {
      question: "What plans are there, and do I need to cancel a subscription?",
      answer:
        "Credits come in one-time packs paid through Razorpay. Nothing renews, so there's no subscription to cancel. Pack credits last 12 months from purchase. The pricing page lists the current packs.",
    },
    {
      question: "How do I create an account?",
      answer: "Sign in with Google on the sign-in page. Signing in creates your account, and we never see your Google password.",
    },
    {
      question: "How are my photos and payments kept safe?",
      answer:
        "Your uploads and results are stored privately for your account. Payments go through Razorpay's checkout, so your card or UPI details are entered with Razorpay, not on Aabhar Studio.",
    },
    {
      question: "How do I contact support?",
      answer: `Email ${brand.supportEmail} or message us on WhatsApp at ${brand.supportWhatsAppDisplay}. The contact page has both.`,
    },
    ...faqs,
  ];
}

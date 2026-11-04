/**
 * Shared content types for marketing and demo data.
 * Presentational components receive these as props; they never import
 * data modules directly, so the same components can later render data
 * from Supabase or a CMS.
 */

/** Where an image came from — drives the visible demo/licence labels. */
export type ImageProvenance =
  /** Free-to-use under the Unsplash licence; credit shown. */
  | "unsplash"
  /** Supplied by the product owner as sample material; rights to be confirmed before launch. */
  | "user-supplied"
  /** Created for the demo by degrading a studio photo. Not an AI output. */
  | "simulated";

export interface DemoImage {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  provenance: ImageProvenance;
  /** Photographer or source credit, shown for Unsplash images. */
  credit?: string;
}

export type JewelleryCategory =
  | "rings"
  | "necklaces"
  | "earrings"
  | "bangles"
  | "anklets"
  | "bridal";

export interface BeforeAfterPair {
  id: string;
  before: DemoImage;
  after: DemoImage;
  /** Short caption shown under the comparison, e.g. preset name. */
  caption: string;
  /** True for pairs that are illustrations rather than real product output. */
  isDemo: boolean;
  /** Plain-language note shown with demo pairs. */
  demoNote?: string;
}

export interface NavLink {
  label: string;
  href: string;
  description?: string;
}

export interface FeatureStep {
  number: string;
  title: string;
  body: string;
  image: DemoImage;
}

export interface StylePreset {
  slug: string;
  name: string;
  description: string;
  creditCost: number;
  bestFor: string[];
  /** Mood reference photo; when absent the card shows the preset's colour swatch. */
  image?: DemoImage;
  swatch?: { background: string; accent: string };
}

export interface Segment {
  id: "retailers" | "wholesalers" | "brands" | "marketplace";
  title: string;
  body: string;
  href: string;
  points: string[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export type BillingInterval = "monthly" | "yearly";

export interface PlanLimit {
  label: string;
  value: string;
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  /** Prices in paise, as charged. `null` = free. */
  pricePaise: Record<BillingInterval, number | null>;
  creditsPerMonth: number;
  /** One-time credits (trial). */
  oneTimeCredits?: number;
  limits: PlanLimit[];
  highlights: string[];
  cta: { label: string; href: string };
  recommended?: boolean;
}

export interface PricingConfig {
  currency: "INR";
  gstRatePercent: number;
  /** Whether the listed price already includes GST. Checkout charges exactly the listed price. */
  gstIncluded: boolean;
  /** Free trial credits granted at sign-up. */
  trialCredits: number;
  /** "indicative" until pricing is approved; shown as a label in the UI. */
  status: "indicative" | "final";
  annualDiscountLabel: string;
  plans: Plan[];
}

import { BuiltForStrip } from "@/components/marketing/built-for-strip";
import { CatalogueBand } from "@/components/marketing/catalogue-band";
import { CategoryShowcase } from "@/components/marketing/category-showcase";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { MobileStickyCta } from "@/components/marketing/mobile-sticky-cta";
import { PhotoGallerySection } from "@/components/marketing/photo-gallery-section";
import { PresetShowcase } from "@/components/marketing/preset-showcase";
import { PricingTeaser } from "@/components/marketing/pricing-teaser";
import { Segments } from "@/components/marketing/segments";
import { freeImagesMessage, pricingPacks } from "@/config/plans";
import { getPublicPricing } from "@/server/billing/public-pricing";
import { heroPair } from "@/content/demo-images";
import { PHOTO_GALLERY } from "@/content/photo-gallery";
import {
  builtFor,
  catalogueFeature,
  catalogueSample,
  categoryShowcase,
  faqs,
  finalCta,
  heroContent,
  presets,
  segments,
  steps,
} from "@/content/marketing";

/**
 * Homepage. A server component that only composes data into
 * presentational sections — no business logic lives here.
 */
export default async function HomePage() {
  const { pricing } = await getPublicPricing();
  return (
    <>
      <Hero {...heroContent} trustLine={`${freeImagesMessage(pricing.trialCredits)} ${heroContent.trustLine}`} pair={heroPair} />
      <BuiltForStrip label="Designed for" items={builtFor} />
      <HowItWorks steps={steps} />
      <PresetShowcase presets={presets} />
      <PhotoGallerySection photos={PHOTO_GALLERY} />
      <CategoryShowcase categories={categoryShowcase} />
      <CatalogueBand {...catalogueFeature} cover={catalogueSample.cover} items={catalogueSample.items} />
      <Segments segments={segments} />
      <PricingTeaser pricing={pricing} packs={pricingPacks} />
      <Faq items={faqs} supportHref="/contact" />
      <FinalCta {...finalCta} body={`${freeImagesMessage(pricing.trialCredits)} Bring a few pieces, a phone and good daylight.`} />
      <MobileStickyCta label={heroContent.primaryCta.label} href={heroContent.primaryCta.href} watchId="hero-cta" />
    </>
  );
}

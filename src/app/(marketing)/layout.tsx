import { SiteFooter } from "@/components/marketing/site-footer";
import { pricing } from "@/config/plans";
import { SiteHeader } from "@/components/marketing/site-header";
import { DemoNotice } from "@/components/shared/demo-notice";
import { demoImages } from "@/content/demo-images";
import {
  brand,
  demoNoticeMessage,
  footerColumns,
  heroContent,
  primaryNav,
  solutionsNav,
} from "@/content/marketing";

const imageCredits = Object.values(demoImages)
  .flatMap((img) => (img.provenance === "unsplash" && img.credit ? [img.credit.replace(" on Unsplash", "")] : []))
  .concat("Unsplash");

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-ink-900 px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <DemoNotice message={demoNoticeMessage} />
      <SiteHeader
        brandName={brand.name}
        primaryNav={primaryNav}
        solutionsNav={solutionsNav}
        cta={{ label: "Try free", href: heroContent.primaryCta.href }}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter brandName={brand.name} tagline={brand.tagline} columns={footerColumns} imageCredits={imageCredits}
        priceNote={`Prices ${pricing.gstIncluded ? "include" : "exclude"} ${pricing.gstRatePercent}% GST.`}
      />
    </>
  );
}

import type { Metadata } from "next";

import { FinalCta } from "@/components/marketing/final-cta";
import { StyleGallery } from "@/components/marketing/style-gallery";
import { Container, Section } from "@/components/shared/container";
import { Display, Lead, Overline } from "@/components/shared/typography";
import { STYLE_PREVIEWS } from "@/content/style-previews";

export const metadata: Metadata = {
  title: "Jewellery Photography Styles",
  description: "Explore AI photography styles for rings, earrings, bangles, payal, maang tikka, pendants and jewellery sets.",
};

export default function StylesPage() {
  return (
    <>
      <Section tone="surface" aria-labelledby="styles-title" className="lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Overline>Style gallery</Overline>
            <Display as="h1" id="styles-title" className="mt-4">
              Explore Jewellery Photography Styles
            </Display>
            <Lead className="mt-5">
              Discover premium AI photography styles for every jewellery collection. Choose the perfect look for your product.
            </Lead>
          </div>
          <div className="mt-10">
            <StyleGallery previews={STYLE_PREVIEWS} />
          </div>
        </Container>
      </Section>
      {/* /app/studio sends signed-out visitors to sign in first, then on to the Studio. */}
      <FinalCta
        title="Create Your Own Jewellery Catalogue"
        body="Transform your jewellery product photos into premium catalogue-ready images using AI."
        cta={{ label: "Start Creating", href: "/app/studio" }}
      />
    </>
  );
}

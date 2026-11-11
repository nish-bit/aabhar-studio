import type { Metadata } from "next";
import Link from "next/link";

import { FinalCta } from "@/components/marketing/final-cta";
import { StyleGallery } from "@/components/marketing/style-gallery";
import { Container, Section } from "@/components/shared/container";
import { Display, Heading, Lead, Overline } from "@/components/shared/typography";
import { STYLE_PREVIEWS } from "@/content/style-previews";
import { JsonLd } from "@/components/seo/json-ld";
import { PRESET_SLUGS, PRESETS } from "@/lib/presets";
import { pageMetadata } from "@/lib/site";
import { breadcrumbSchema, graph } from "@/lib/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Jewellery Photography Styles",
  description:
    "Example jewellery photographs for rings, earrings, bangles, payal, maang tikka, pendants and sets, and the six studio looks you can choose in Aabhar Studio.",
  path: "/styles",
});

export default function StylesPage() {
  return (
    <>
      <JsonLd data={graph(breadcrumbSchema("Photography styles", "/styles"))} />
      <Section tone="surface" aria-labelledby="styles-title" className="lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Overline>Style gallery</Overline>
            <Display as="h1" id="styles-title" className="mt-4">
              Explore Jewellery Photography Styles
            </Display>
            <Lead className="mt-5">
              Example photographs for rings, earrings, bracelets and bangles, payal, maang tikka, pendants and jewellery sets. Filter by
              type, then open any photo to see it larger.
            </Lead>
          </div>
          <div className="mt-10">
            <StyleGallery previews={STYLE_PREVIEWS} />
          </div>
        </Container>
      </Section>
      <Section aria-labelledby="looks-title">
        <Container>
          <div className="max-w-2xl">
            <Overline>In the Studio</Overline>
            <Display id="looks-title" className="mt-4">
              The six studio looks you can choose
            </Display>
            <Lead className="mt-5">
              Every image you generate uses one of these looks. The credit cost is shown before you generate, and{" "}
              <Link href="/pricing" className="text-gold-700 underline underline-offset-4 hover:text-ink-900">
                credit packs are listed on the pricing page
              </Link>
              .
            </Lead>
          </div>
          <ul className="mt-10 grid gap-x-8 gap-y-6 border-t border-ink-200 pt-8 sm:grid-cols-2 lg:grid-cols-3">
            {PRESET_SLUGS.map((slug) => {
              const p = PRESETS[slug];
              return (
                <li key={slug}>
                  <Heading>{p.name}</Heading>
                  <p className="mt-2 text-body text-ink-600">{p.description}</p>
                  <p className="mt-2 text-body-sm text-ink-500">
                    {p.creditCost} {p.creditCost === 1 ? "credit" : "credits"} per image
                  </p>
                </li>
              );
            })}
          </ul>
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

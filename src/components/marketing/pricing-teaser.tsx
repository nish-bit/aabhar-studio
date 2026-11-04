import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Container, Section } from "@/components/shared/container";
import { Display, Lead, Overline } from "@/components/shared/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { freeImagesMessage } from "@/config/plans";
import type { PricingConfig } from "@/types/content";

import { PackPlans } from "./pack-plans";
import type { PackOffer } from "./pricing-page";

export interface PricingTeaserProps {
  pricing: PricingConfig;
  packs: PackOffer[];
}

/** One-time credit plans on the homepage; /pricing has the same cards plus the billing FAQs. */
export function PricingTeaser({ pricing, packs }: PricingTeaserProps) {
  return (
    <Section tone="surface" aria-labelledby="pricing-title">
      <Container>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <Overline>Pricing</Overline>
            <Display id="pricing-title" className="mt-4">
              Pay once for the photos you need
            </Display>
            <Lead className="mt-5">
              Buy credits once, no subscription. Essential styles use 1 credit per image and premium styles 2, and failed images are refunded
              automatically.
            </Lead>
          </div>
          {pricing.status === "indicative" && (
            <Badge tone="warning" className="self-start md:self-auto">
              Indicative pricing — not final
            </Badge>
          )}
        </div>

        <div className="mt-12">
          <PackPlans packs={packs} />
        </div>

        <div className="mt-8 flex flex-col gap-2 text-body-sm text-ink-600 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Prices {pricing.gstIncluded ? "include" : "exclude"} {pricing.gstRatePercent}% GST. {freeImagesMessage(pricing.trialCredits)} No card needed.
          </p>
          <Button asChild variant="link">
            <Link href="/pricing">
              See full pricing
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}

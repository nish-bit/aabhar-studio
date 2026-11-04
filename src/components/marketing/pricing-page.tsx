import Link from "next/link";

import { Container, Section } from "@/components/shared/container";
import { Display, Lead, Overline } from "@/components/shared/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { freeImagesMessage } from "@/config/plans";
import type { FaqItem, PricingConfig } from "@/types/content";

import { Faq } from "./faq";
import { PackPlans } from "./pack-plans";

export interface ComparisonRow {
  label: string;
  /** One value per plan, in the same order as `pricing.plans`. `true`/`false` render as tick / dash. */
  values: (string | boolean)[];
}

export interface PackOffer {
  id: string;
  name: string;
  credits: number;
  pricePaise: number;
  validityDays: number;
  /** Price of one credit, in paise (rounded). */
  perCreditPaise: number;
  badge?: string;
  /** Highlighted card. */
  featured?: boolean;
  features: string[];
  /** Only for shops that have never bought a pack (the Starter Pack). */
  firstPurchaseOnly?: boolean;
}

export interface PricingPageProps {
  pricing: PricingConfig;
  packs: PackOffer[];
  faqs: FaqItem[];
}

/** Full pricing page: one-time credit plans, the free trial and billing FAQs. */
export function PricingPageView({ pricing, packs, faqs }: PricingPageProps) {
  const gstNote = `Prices ${pricing.gstIncluded ? "include" : "exclude"} ${pricing.gstRatePercent}% GST. You're charged exactly the price shown.`;
  return (
    <>
      <Section aria-labelledby="packs-title" className="pb-12 md:pb-16 lg:pb-20">
        <Container>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Overline>Pricing</Overline>
              <Display as="h1" id="packs-title" size="2xl" className="mt-4">
                Pay once for the photos you need
              </Display>
              <Lead className="mt-5">
                Buy credits once, with no subscription. Any pack unlocks all six styles, and failed images are refunded automatically.
              </Lead>
            </div>
            {pricing.status === "indicative" && (
              <Badge tone="warning" className="self-start md:self-auto">
                Indicative pricing — not final
              </Badge>
            )}
          </div>
          <div className="mt-12">
            <PackPlans packs={packs} headingLevel="h2" />
          </div>
          <div className="mt-8 flex flex-col gap-3 rounded-md border border-gold-200 bg-gold-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-sm text-ink-800">
              <strong className="font-semibold text-ink-900">Not sure yet?</strong> {freeImagesMessage(pricing.trialCredits)} No card needed.
            </p>
            <Button asChild variant="secondary" className="shrink-0">
              <Link href="/login">Start free</Link>
            </Button>
          </div>
          <p className="mt-6 text-body-sm text-ink-600">{gstNote} Payments are processed securely by Razorpay; we never see or store your card details.</p>
        </Container>
      </Section>

      <Faq items={faqs} supportHref="/contact" />
    </>
  );
}

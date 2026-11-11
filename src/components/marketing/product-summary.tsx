import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Container, Section } from "@/components/shared/container";
import { Display, Heading, Lead, Overline } from "@/components/shared/typography";
import { Button } from "@/components/ui/button";
import type { productSummary } from "@/content/marketing";

export interface ProductSummaryProps {
  summary: typeof productSummary;
  /** e.g. "Get 2 free AI jewellery images when you sign up." */
  freeImagesLine: string;
  cta: { label: string; href: string };
}

const linkCls = "text-gold-700 underline underline-offset-4 hover:text-ink-900";

/** A plain-text answer to "What is Aabhar Studio?": who it's for, what it does, and how pricing works. */
export function ProductSummary({ summary, freeImagesLine, cta }: ProductSummaryProps) {
  return (
    <Section tone="surface" aria-labelledby="what-is-title">
      <Container>
        <div className="max-w-3xl">
          <Overline>About the product</Overline>
          <Display id="what-is-title" className="mt-4">
            {summary.title}
          </Display>
          <Lead className="mt-5">{summary.answer}</Lead>
          <p className="mt-4 max-w-prose text-body text-ink-600">{summary.problem}</p>
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          <div>
            <Heading>Who it&rsquo;s for</Heading>
            <ul className="mt-4 grid gap-2 text-body text-ink-700">
              {summary.audience.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className={linkCls}>
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Heading>What it does</Heading>
            <ul className="mt-4 grid list-disc gap-2 pl-5 text-body text-ink-700 marker:text-gold-600">
              {summary.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="mt-4 text-body-sm text-ink-600">
              See every look in the{" "}
              <Link href="/styles" className={linkCls}>
                jewellery photography style gallery
              </Link>
              .
            </p>
          </div>
          <div>
            <Heading>Pricing in brief</Heading>
            <p className="mt-4 text-body text-ink-700">
              {freeImagesLine} Then buy one-time credit packs through Razorpay, with no subscription. Most looks use 1 credit per image and scene
              looks use 2.
            </p>
            <p className="mt-4 text-body-sm text-ink-600">
              <Link href="/pricing" className={linkCls}>
                Compare credit packs and prices
              </Link>{" "}
              or{" "}
              <Link href="/contact" className={linkCls}>
                contact us
              </Link>{" "}
              with questions.
            </p>
            <Button asChild className="mt-6">
              <Link href={cta.href}>
                {cta.label}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}

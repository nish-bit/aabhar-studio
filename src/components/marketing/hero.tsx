import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { BeforeAfter } from "@/components/shared/before-after";
import { Container } from "@/components/shared/container";
import { Display, Lead } from "@/components/shared/typography";
import { Button } from "@/components/ui/button";
import type { BeforeAfterPair } from "@/types/content";

export interface HeroProps {
  overline: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  trustLine: string;
  pair: BeforeAfterPair;
}

export function Hero({ overline, title, subtitle, primaryCta, secondaryCta, trustLine, pair }: HeroProps) {
  return (
    <section aria-labelledby="hero-title" className="pb-16 pt-8 md:pb-24 md:pt-12 lg:pb-32 lg:pt-16">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <Reveal>
              {/* The overline is part of the H1 so the heading says what the product is; it looks the same as before. */}
              <Display as="h1" id="hero-title" size="2xl">
                <span className="block font-sans text-overline font-semibold uppercase tracking-[0.12em] text-gold-700">{overline}</span>
                <span className="sr-only">: </span>
                <span className="mt-5 block">{title}</span>
              </Display>
              <Lead className="mt-6 max-w-md">{subtitle}</Lead>
              <div id="hero-cta" className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href={primaryCta.href}>
                    {primaryCta.label}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
                </Button>
              </div>
              <p className="mt-5 text-body-sm text-ink-500">{trustLine}</p>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <Reveal delay={0.15}>
              <figure>
                <BeforeAfter
                  before={pair.before}
                  after={pair.after}
                  beforeLabel="Phone photo"
                  afterLabel="Studio look"
                  label="Compare phone photo and studio look"
                  introSweep
                  eager
                  aspect="1 / 1"
                  sizes="(min-width: 1024px) 680px, 100vw"
                  className="-mx-4 rounded-none shadow-product sm:mx-0 sm:rounded-xs"
                />
                <figcaption className="mt-3 flex flex-col gap-1 text-caption text-ink-500 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <span className="font-medium text-ink-700">{pair.caption}</span>
                  {pair.isDemo && pair.demoNote && <span className="max-w-sm sm:text-right">{pair.demoNote}</span>}
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}

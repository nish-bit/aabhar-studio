import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { Container, Section } from "@/components/shared/container";
import { Display, Overline } from "@/components/shared/typography";
import { Button } from "@/components/ui/button";
import type { DemoImage } from "@/types/content";

export interface CatalogueSampleItem {
  image: DemoImage;
  name: string;
  sku: string;
}

export interface CatalogueBandProps {
  overline: string;
  title: string;
  body: string;
  points: string[];
  cta: { label: string; href: string };
  cover: { title: string; subtitle: string; image: DemoImage };
  items: CatalogueSampleItem[];
}

/** Dark editorial band showing an illustrative catalogue spread. */
export function CatalogueBand({ overline, title, body, points, cta, cover, items }: CatalogueBandProps) {
  return (
    <Section id="catalogues" tone="inverse" aria-labelledby="catalogue-title" className="overflow-hidden">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Overline className="text-gold-300">{overline}</Overline>
            <Display id="catalogue-title" className="mt-4 text-on-inverse">
              {title}
            </Display>
            <p className="mt-5 text-body-lg text-on-inverse/75">{body}</p>
            <ul className="mt-8 grid gap-3">
              {points.map((p) => (
                <li key={p} className="flex gap-3 text-body text-on-inverse/90">
                  <Check className="mt-1 size-4 shrink-0 text-gold-300" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline-inverse" size="lg" className="mt-10">
              <Link href={cta.href}>
                {cta.label}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>

          <div className="lg:col-span-7">
            <Reveal distance={24}>
              <figure>
                {/* Illustrative A4 spread: cover page + product grid page */}
                <div className="grid grid-cols-2 gap-px bg-ink-700 shadow-lg" aria-hidden>
                  <div className="relative aspect-[3/4] bg-surface-inverse">
                    <Image src={cover.image.src} alt="" fill sizes="(min-width: 1024px) 340px, 50vw" className="object-cover opacity-80" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900/95 to-transparent p-4 pt-16 sm:p-6 sm:pt-24">
                      <p className="text-[0.5625rem] font-semibold uppercase tracking-[0.18em] text-gold-300 sm:text-overline">
                        {cover.subtitle}
                      </p>
                      <p className="mt-1 font-serif text-[1.25rem] leading-tight text-on-inverse sm:text-display-sm">{cover.title}</p>
                    </div>
                  </div>
                  <div className="grid aspect-[3/4] grid-cols-2 grid-rows-2 gap-2 bg-surface p-2 sm:gap-3 sm:p-4">
                    {items.slice(0, 4).map((item) => (
                      <div key={item.sku} className="flex min-h-0 flex-col">
                        <div className="relative min-h-0 flex-1 bg-surface-raised">
                          <Image src={item.image.src} alt="" fill sizes="(min-width: 1024px) 160px, 25vw" className="object-cover" />
                        </div>
                        <p className="mt-1 truncate font-serif text-[0.6875rem] leading-tight text-ink-900 sm:text-body-sm">
                          {item.name}
                        </p>
                        <p className="truncate text-[0.5rem] text-ink-500 tabular sm:text-[0.625rem]">
                          {item.sku}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <figcaption className="mt-3 text-caption text-on-inverse/60">
                  Sample catalogue spread with demo product details and sample photographs.
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}

import Link from "next/link";
import { ArrowUpRight, Factory, Gem, ShoppingBag, Store, type LucideIcon } from "lucide-react";

import { Container, Section } from "@/components/shared/container";
import { Display, Heading, Overline } from "@/components/shared/typography";
import type { Segment } from "@/types/content";

const icons: Record<Segment["id"], LucideIcon> = {
  retailers: Store,
  wholesalers: Factory,
  brands: Gem,
  marketplace: ShoppingBag,
};

export interface SegmentsProps {
  segments: Segment[];
}

export function Segments({ segments }: SegmentsProps) {
  return (
    <Section aria-labelledby="segments-title">
      <Container>
        <div className="max-w-2xl">
          <Overline>Who it&rsquo;s for</Overline>
          <Display id="segments-title" className="mt-4">
            From a single counter to a wholesale floor
          </Display>
        </div>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-md border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((s) => {
            const Icon = icons[s.id];
            return (
              <li key={s.id} id={`segment-${s.id}`} className="scroll-mt-24 bg-surface">
                <Link
                  href={s.href}
                  className="group flex h-full flex-col p-6 transition-colors duration-[var(--duration-base)] hover:bg-gold-50 focus-visible:bg-gold-50 lg:p-8"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-6 text-gold-600" strokeWidth={1.5} aria-hidden />
                    <ArrowUpRight
                      className="size-4 text-ink-400 transition-[color,transform] duration-[var(--duration-base)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-900"
                      aria-hidden
                    />
                  </div>
                  <Heading size="md" className="mt-8">
                    {s.title}
                  </Heading>
                  <p className="mt-2 text-body-sm text-ink-600">{s.body}</p>
                  <ul className="mt-6 grid gap-1.5 border-t border-ink-200 pt-4">
                    {s.points.map((p) => (
                      <li key={p} className="text-body-sm text-ink-700">
                        {p}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}

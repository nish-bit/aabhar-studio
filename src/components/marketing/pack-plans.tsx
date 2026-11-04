import Link from "next/link";
import { ArrowRight, Check, MessageSquareText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, formatPaise, formatPaiseExact } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { PackOffer } from "./pricing-page";

export interface PackPlansProps {
  packs: PackOffer[];
  /** Heading level for card titles, so the page outline stays correct. */
  headingLevel?: "h2" | "h3" | "h4";
  /** Replaces the default "Get Started" link (e.g. a Buy button that opens checkout in the app). */
  action?: (pack: PackOffer) => React.ReactNode;
}

/**
 * The one-time credit packs as plan cards, plus a Custom Order card. Shared
 * by the homepage and /pricing. Server-rendered; hover effects are CSS only
 * and switched off for people who prefer reduced motion. "Get started"
 * goes to the existing pack checkout on /app/billing (sign-in first).
 */
/** "Solo Plan", but "Starter Pack" stays as named. */
export const packTitle = (pack: { name: string }) => (/(pack|plan)$/i.test(pack.name) ? pack.name : `${pack.name} Plan`);

export function PackPlans({ packs, headingLevel: H = "h3", action }: PackPlansProps) {
  return (
    <div>
      <ul className={cn("grid gap-6 pt-3 md:grid-cols-2", packs.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
        {packs.map((pack) => (
          <li
            key={pack.id}
            className={cn(
              "group relative flex flex-col rounded-md border bg-canvas p-6 lg:p-8",
              "transition-[border-color,box-shadow,transform] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
              "hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-1",
              pack.featured ? "border-gold-400 shadow-[var(--shadow-sm)] lg:-my-3 lg:py-11" : "border-ink-200 hover:border-gold-300",
              // Tablet: two columns, so a lone last card spans the row instead of leaving a gap.
              "md:[&:last-child:nth-child(odd)]:col-span-2 lg:[&:last-child:nth-child(odd)]:col-span-1",
            )}
          >
            {pack.badge && (
              <Badge tone={pack.featured ? "gold" : "neutral"} className="absolute -top-3 left-6 shadow-[var(--shadow-xs)]">
                {pack.badge}
              </Badge>
            )}
            <H className="font-serif text-display-sm font-semibold text-ink-900">{packTitle(pack)}</H>

            <p className="mt-5 flex items-baseline gap-2">
              <span className="font-serif text-display-md font-semibold tabular text-ink-900">{formatPaise(pack.pricePaise)}</span>
              <span className="text-body-sm text-ink-600">one-time</span>
            </p>
            <p className="mt-1 text-body-sm font-medium tabular text-gold-700">{formatPaiseExact(pack.perCreditPaise)} / image</p>

            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-sm bg-surface-sunken p-3 text-center">
              <div>
                <dt className="text-caption text-ink-600">Credits</dt>
                <dd className="tabular text-heading-sm font-semibold text-ink-900">{formatCount(pack.credits)}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-600">Product images</dt>
                <dd className="tabular text-heading-sm font-semibold text-ink-900">{formatCount(pack.credits)}</dd>
              </div>
            </dl>

            <ul className="mt-6 grid flex-1 gap-2.5">
              {pack.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-body-sm text-ink-700">
                  <Check className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
                  {f}
                </li>
              ))}
              <li className="flex gap-2.5 text-body-sm text-ink-700">
                <Check className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
                Credits valid for {Math.round(pack.validityDays / 30.4)} months
              </li>
            </ul>

            {action ? (
              <div className="mt-8">{action(pack)}</div>
            ) : (
              <Button asChild size="lg" variant={pack.featured ? "primary" : "secondary"} className="mt-8 w-full">
                <Link href={`/app/billing?pack=${pack.id}`} aria-label={`Get started with the ${packTitle(pack)}`}>
                  Get Started
                  <ArrowRight className="transition-transform duration-[var(--duration-fast)] motion-safe:group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-caption text-ink-600">
        One credit makes one image in the essential styles (White Studio, Warm Ivory, Black Luxury). Velvet, Marble and Editorial, unlocked by
        any plan here, use 2 credits per image.
      </p>

      <div className="mt-10 flex flex-col gap-6 rounded-md bg-surface-inverse p-6 text-on-inverse md:flex-row md:items-center md:justify-between lg:p-8">
        <div className="flex gap-4">
          <MessageSquareText className="mt-1 size-6 shrink-0 text-gold-300" strokeWidth={1.5} aria-hidden />
          <div>
            <H className="font-serif text-display-sm font-semibold">Custom Order</H>
            <p className="mt-2 max-w-2xl text-body-sm text-on-inverse/80">
              Photographing a large collection, need more than 500 images, or want one consistent look across a whole catalogue? Tell us what you
              need and we&apos;ll put together a quote.
            </p>
          </div>
        </div>
        <Button asChild size="lg" variant="accent" className="shrink-0">
          <Link href="/contact">
            Contact us
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

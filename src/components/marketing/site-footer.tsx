import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import type { NavLink } from "@/types/content";

export interface SiteFooterProps {
  brandName: string;
  tagline: string;
  columns: { title: string; links: NavLink[] }[];
  /** Credits for licensed imagery used on the page. */
  imageCredits: string[];
  /** e.g. "Prices include 18% GST." — derived from the billing config. */
  priceNote: string;
}

export function SiteFooter({ brandName, tagline, columns, imageCredits, priceNote }: SiteFooterProps) {
  const year = 2026;
  return (
    <footer className="border-t border-ink-200 bg-surface">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6 lg:px-8 xl:px-12">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div className="max-w-xs">
            <Logo name={brandName} />
            <p className="mt-4 text-body-sm text-ink-600">{tagline}</p>
            <p className="mt-2 text-body-sm text-ink-600">Made in New Delhi for jewellers across India.</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {columns.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="text-overline font-semibold uppercase tracking-[0.12em] text-ink-500">{col.title}</h2>
                <ul className="mt-4 grid gap-2.5">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-body-sm text-ink-700 transition-colors hover:text-gold-700">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-ink-200 pt-6 text-caption text-ink-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {brandName}. {priceNote}
          </p>
          {imageCredits.length > 0 && <p>Photography: {imageCredits.join(" · ")}</p>}
        </div>
      </div>
    </footer>
  );
}

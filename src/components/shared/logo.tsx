import Link from "next/link";

import { cn } from "@/lib/utils";

export interface LogoProps {
  name: string;
  href?: string;
  tone?: "ink" | "inverse";
  className?: string;
}

/**
 * Placeholder wordmark: a small faceted gem mark and the serif name.
 * Replace with the final logo once the brand is approved.
 */
export function Logo({ name, href = "/", tone = "ink", className }: LogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-sm",
        tone === "ink" ? "text-ink-900" : "text-on-inverse",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <path d="M12 2 21 9l-9 13L3 9z" fill="none" stroke="var(--gold-400)" strokeWidth="1.25" />
        <path d="M3 9h18M12 2 8.5 9 12 22l3.5-13z" fill="none" stroke="var(--gold-400)" strokeWidth="1" />
      </svg>
      <span className="font-serif text-[1.375rem] font-semibold leading-none tracking-[-0.01em]">{name}</span>
    </Link>
  );
}

import * as React from "react";

import { cn } from "@/lib/utils";

type HeadingLevel = "h1" | "h2" | "h3" | "h4";

const displaySizes = {
  "2xl": "text-[2.75rem] leading-[3rem] md:text-display-lg lg:text-display-2xl",
  xl: "text-[2.375rem] leading-[2.625rem] md:text-display-xl",
  lg: "text-[2rem] leading-[2.375rem] md:text-display-lg",
  md: "text-[1.75rem] leading-[2.125rem] md:text-display-md",
  sm: "text-[1.5rem] leading-[1.875rem] md:text-display-sm",
} as const;

export interface DisplayProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingLevel;
  size?: keyof typeof displaySizes;
}

/** Serif display headline. Only used at 24px and above. */
export function Display({ as: Tag = "h2", size = "xl", className, ...props }: DisplayProps) {
  return (
    <Tag
      className={cn(
        "font-serif font-medium tracking-[-0.01em] text-balance text-ink-900",
        displaySizes[size],
        className,
      )}
      {...props}
    />
  );
}

const headingSizes = {
  lg: "text-heading-lg",
  md: "text-heading-md",
  sm: "text-heading-sm",
} as const;

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingLevel;
  size?: keyof typeof headingSizes;
}

/** Sans-serif heading for panels, cards and app UI. */
export function Heading({ as: Tag = "h3", size = "md", className, ...props }: HeadingProps) {
  return <Tag className={cn("font-semibold text-ink-900", headingSizes[size], className)} {...props} />;
}

/** Uppercase eyebrow above a display title. */
export function Overline({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-overline font-semibold uppercase tracking-[0.12em] text-gold-700", className)}
      {...props}
    />
  );
}

const leadSizes = { lg: "text-body-lg", md: "text-body" } as const;

export interface LeadProps extends React.HTMLAttributes<HTMLParagraphElement> {
  size?: keyof typeof leadSizes;
}

/** Secondary body copy under headlines. */
export function Lead({ size = "lg", className, ...props }: LeadProps) {
  return <p className={cn("text-pretty text-ink-600", leadSizes[size], className)} {...props} />;
}

/** A short thin gold rule used as an editorial divider. */
export function GoldRule({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-px w-12 bg-gold-300", className)} />;
}

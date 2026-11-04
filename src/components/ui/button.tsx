import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium",
    "transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-ink-900 text-on-inverse hover:bg-ink-800 active:bg-ink-700",
        secondary:
          "border border-ink-300 bg-surface text-ink-900 hover:bg-ink-100 hover:shadow-xs active:bg-ink-200",
        ghost: "text-ink-900 hover:bg-ink-100 active:bg-ink-200",
        /** Gold on dark bands only — fails contrast on ivory. */
        accent: "bg-gold-300 text-ink-900 hover:bg-gold-200 active:bg-gold-400",
        /** Outline for use on dark bands. */
        "outline-inverse":
          "border border-on-inverse/40 text-on-inverse hover:border-on-inverse hover:bg-on-inverse/10",
        destructive: "bg-error-fg text-white hover:bg-error-fg/90",
        link: "h-auto px-0 text-gold-700 underline underline-offset-4 hover:text-ink-900",
      },
      size: {
        sm: "h-8 px-3 text-body-sm",
        md: "h-10 px-4 text-body",
        lg: "h-12 px-6 text-body",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next.js Link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner, keeps the button width, and disables interaction. */
  loading?: boolean;
  /** Text announced while loading, e.g. "Enhancing…". */
  loadingLabel?: string;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export { Button, buttonVariants };

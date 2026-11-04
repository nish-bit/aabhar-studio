import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-caption font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-ink-200 bg-ink-100 text-ink-700",
        gold: "border-gold-200 bg-gold-100 text-gold-700",
        success: "border-success-border bg-success-bg text-success-fg",
        warning: "border-warning-border bg-warning-bg text-warning-fg",
        error: "border-error-border bg-error-bg text-error-fg",
        info: "border-info-border bg-info-bg text-info-fg",
        processing: "border-gold-200 bg-gold-50 text-gold-700",
        inverse: "border-on-inverse/25 bg-on-inverse/10 text-on-inverse",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };

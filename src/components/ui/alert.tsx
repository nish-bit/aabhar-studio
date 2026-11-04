import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-3 rounded-md border p-4 text-body-sm", {
  variants: {
    tone: {
      info: "border-info-border bg-info-bg text-info-fg",
      success: "border-success-border bg-success-bg text-success-fg",
      warning: "border-warning-border bg-warning-bg text-warning-fg",
      error: "border-error-border bg-error-bg text-error-fg",
      neutral: "border-ink-200 bg-surface-sunken text-ink-700",
    },
  },
  defaultVariants: { tone: "info" },
});

const icons: Record<NonNullable<VariantProps<typeof alertVariants>["tone"]>, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  neutral: Info,
};

export interface AlertProps extends Omit<React.ComponentProps<"div">, "title">, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  /** Use "alert" for errors that need immediate attention; default is a polite status. */
  live?: "polite" | "assertive" | "off";
}

/** Inline message. Always pairs colour with an icon and words. */
function Alert({ tone = "info", title, live = "polite", className, children, ...props }: AlertProps) {
  const Icon = icons[tone ?? "info"];
  return (
    <div
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live === "off" ? undefined : live}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-700 [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}

export { Alert };

import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-sm border border-ink-300 bg-surface px-3 text-body text-ink-900 placeholder:text-ink-500",
        "transition-colors focus-visible:border-gold-600 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error-fg",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-sm border border-ink-300 bg-surface px-3 py-2.5 text-body text-ink-900 placeholder:text-ink-500",
        "transition-colors focus-visible:border-gold-600 disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-error-fg",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

import { AlertTriangle } from "lucide-react";

/** Shown with every result: AI edits can change details. */
export function FidelityWarning({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" className="flex gap-3 rounded-md border border-warning-border bg-warning-bg p-4 text-body-sm text-warning-fg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">Check every detail before you publish</p>
        {!compact && (
          <p className="text-ink-700">
            The image service is asked to keep your piece unchanged, but AI edits can still alter details. Compare the
            stone count and colour, metal colour, engravings, proportions and setting with your original before using
            this image to sell.
          </p>
        )}
      </div>
    </div>
  );
}

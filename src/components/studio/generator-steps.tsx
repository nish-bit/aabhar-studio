import { Check } from "lucide-react";

import { GENERATOR_STEPS } from "@/lib/jewellery-types";
import { cn } from "@/lib/utils";

/** "Step 2 of 5 — Upload Photo" with a progress bar and the step names. `current` is 1-based. */
export function GeneratorSteps({ current }: { current: number }) {
  const total = GENERATOR_STEPS.length;
  const pct = (current / total) * 100;
  return (
    <div className="mb-8">
      <p className="text-overline font-semibold uppercase tracking-[0.14em] text-gold-700" aria-live="polite">
        Step {current} of {total} — {GENERATOR_STEPS[current - 1]}
      </p>
      <div
        role="progressbar"
        aria-label="Generator progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100"
      >
        <div className="h-full rounded-full bg-gold-500 transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-standard)]" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-5 gap-2">
        {GENERATOR_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold tabular",
                  active && "border-ink-900 bg-ink-900 text-on-inverse",
                  done && "border-gold-500 bg-gold-500 text-ink-900",
                  !active && !done && "border-ink-300 text-ink-500",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : n}
              </span>
              <span className={cn("hidden truncate text-body-sm sm:inline", active ? "font-semibold text-ink-900" : "text-ink-600")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

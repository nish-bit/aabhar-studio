"use client";

import * as React from "react";

import type { JobStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export interface GenerationStatusProps {
  status: JobStatus | "submitting";
  /** ISO time the job was created; drives the elapsed timer. */
  since: string | null;
  presetName: string;
}

const STEPS: { key: "submitting" | "queued" | "processing"; label: string }[] = [
  { key: "submitting", label: "Sending" },
  { key: "queued", label: "Queued" },
  { key: "processing", label: "Editing" },
];

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Real status from the server plus an elapsed timer. There's no percentage:
 * the provider doesn't report one, and we won't invent it.
 */
export function GenerationStatus({
  status,
  since,
  presetName,
}: GenerationStatusProps) {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    // First tick right after mount (not during render), so the server and the first client render agree.
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const current = STEPS.findIndex((s) => s.key === status);

  const elapsed =
    since && now !== null
      ? Math.max(0, now - new Date(since).getTime())
      : 0;

  return (
    <div className="rounded-md border border-ink-200 bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-heading-sm font-semibold text-ink-900">
          Creating your {presetName} image
        </p>

        {since && (
          <span
            className="text-body-sm text-ink-600 tabular"
            aria-label={`Elapsed ${formatElapsed(elapsed)}`}
          >
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      <ol className="mt-4 flex gap-2" aria-label="Progress">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";

          return (
            <li key={step.key} className="flex-1">
              <span
                className={cn(
                  "block h-1 rounded-full",
                  state === "done" && "bg-gold-400",
                  state === "active" && "animate-pulse bg-gold-300",
                  state === "todo" && "bg-ink-200",
                )}
                aria-hidden
              />

              <span
                className={cn(
                  "mt-2 block text-caption",
                  state === "todo"
                    ? "text-ink-500"
                    : "font-medium text-ink-900",
                )}
                aria-current={state === "active" ? "step" : undefined}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-body-sm text-ink-600" role="status" aria-live="polite">
        {status === "processing"
          ? "The image service is editing your photo. This can take a minute or two — you can keep this page open."
          : status === "queued"
            ? "Waiting for the image service to start."
            : "Starting…"}
      </p>
    </div>
  );
}

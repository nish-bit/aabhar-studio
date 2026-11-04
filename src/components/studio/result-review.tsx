"use client";

import * as React from "react";
import { Check, Download, RefreshCw, Trash2 } from "lucide-react";

import { BeforeAfter } from "@/components/shared/before-after";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GenerationView } from "@/lib/api-types";
import { PRESETS } from "@/lib/presets";
import { cn } from "@/lib/utils";

import { FidelityWarning } from "./fidelity-warning";

export interface ResultReviewProps {
  job: GenerationView & { result: NonNullable<GenerationView["result"]> };
  downloadHref: string;
  regenerateCost: number;
  busyAction: "approve" | "discard" | null;
  regenerating: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onImageError: () => void;
}

type View = "side-by-side" | "slider";

/** Original and edited image together, with review actions. */
export function ResultReview({
  job,
  downloadHref,
  regenerateCost,
  busyAction,
  regenerating,
  onApprove,
  onDiscard,
  onRegenerate,
  onImageError,
}: ResultReviewProps) {
  const [view, setView] = React.useState<View>("side-by-side");
  const approved = job.result.reviewStatus === "approved";
  const preset = PRESETS[job.presetSlug];

  return (
    <section aria-labelledby="result-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id="result-title" className="text-heading-md font-semibold text-ink-900">
            {preset.name} result
          </h2>
          {approved ? <Badge tone="success"><Check aria-hidden />Approved</Badge> : <Badge tone="warning">Needs review</Badge>}
        </div>
        <div role="group" aria-label="Comparison view" className="inline-flex rounded-sm border border-ink-300 p-0.5">
          {(["side-by-side", "slider"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-8 rounded-xs px-3 text-body-sm font-medium transition-colors",
                view === v ? "bg-ink-900 text-on-inverse" : "text-ink-700 hover:bg-ink-100",
              )}
            >
              {v === "side-by-side" ? "Side by side" : "Slider"}
            </button>
          ))}
        </div>
      </div>

      {view === "side-by-side" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Original", src: job.source.url, alt: `Original photo: ${job.source.fileName}` },
            { label: "Edited", src: job.result.url, alt: `Edited with the ${preset.name} style` },
          ].map((img) => (
            <figure key={img.label} className="overflow-hidden rounded-md border border-ink-200 bg-surface-raised">
              {/* Plain <img>: signed private URLs must not pass through the image optimiser. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt} onError={onImageError} className="aspect-square w-full object-contain" />
              <figcaption className="border-t border-ink-200 px-3 py-2 text-caption font-medium text-ink-700">{img.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <BeforeAfter
          before={{ src: job.source.url, alt: `Original photo: ${job.source.fileName}` }}
          after={{ src: job.result.url, alt: `Edited with the ${preset.name} style` }}
          beforeLabel="Original"
          afterLabel="Edited"
          label="Compare original and edited"
          unoptimized
          sizes="(min-width: 1024px) 720px, 100vw"
          className="mx-auto max-w-2xl border border-ink-200 bg-surface-raised"
        />
      )}

      <FidelityWarning />

      <div className="flex flex-wrap gap-2">
        {!approved && (
          <Button onClick={onApprove} loading={busyAction === "approve"} loadingLabel="Approving…" disabled={busyAction !== null}>
            <Check aria-hidden />
            Approve
          </Button>
        )}
        <Button asChild variant={approved ? "primary" : "secondary"}>
          <a href={downloadHref} download>
            <Download aria-hidden />
            Download
          </a>
        </Button>
        <Button variant="secondary" onClick={onRegenerate} loading={regenerating} loadingLabel="Starting…" disabled={busyAction !== null}>
          <RefreshCw aria-hidden />
          Regenerate · {regenerateCost} {regenerateCost === 1 ? "credit" : "credits"}
        </Button>
        <Button variant="ghost" onClick={onDiscard} loading={busyAction === "discard"} loadingLabel="Discarding…" disabled={busyAction !== null}>
          <Trash2 aria-hidden />
          Discard
        </Button>
      </div>
      {job.instructions && (
        <p className="text-caption text-ink-500">
          Your notes: <span className="text-ink-700">“{job.instructions}”</span>
        </p>
      )}
    </section>
  );
}

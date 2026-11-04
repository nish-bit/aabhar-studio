"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { FreeTrialStatus } from "@/components/billing/free-trial-status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { studioApi } from "@/features/studio/api-client";
import { useStudio } from "@/features/studio/use-studio";
import { jewelleryTypeById, type JewelleryTypeId } from "@/lib/jewellery-types";
import type { FreeTrialView } from "@/lib/billing-types";
import type { PhotoSizeId } from "@/lib/photo-sizes";
import { PRESETS, type PresetAvailability, type PresetSlug } from "@/lib/presets";
import { INSTRUCTIONS_MAX_LENGTH } from "@/lib/upload-limits";

import { FidelityWarning } from "./fidelity-warning";
import { GeneratorSteps } from "./generator-steps";
import { GenerationStatus } from "./generation-status";
import { IntegrationNotice } from "./integration-notice";
import { PhotoDropzone } from "./photo-dropzone";
import { PhotoSizePicker } from "./photo-size-picker";
import { PresetPicker } from "./preset-picker";
import { ResultReview } from "./result-review";

export interface StudioProps {
  initialBalance: number;
  providerConfigured: boolean;
  providerLabel: string | null;
  /** Admin preset settings and plan access for this shop. */
  presetAvailability?: PresetAvailability;
  /** Chosen in step 1; sent with each generation and added to the prompt. */
  jewelleryType?: JewelleryTypeId | null;
  /** From ?size= in the URL, so a reload keeps the step-4 choice. */
  initialPhotoSize?: PhotoSizeId | null;
  /** The account's free trial grant, shown with the live balance. */
  freeTrial?: FreeTrialView | null;
}

/** Single-photo studio: upload → choose style → generate → review → download. */
export function Studio({
  initialBalance,
  providerConfigured,
  providerLabel,
  presetAvailability,
  jewelleryType = null,
  initialPhotoSize = null,
  freeTrial = null,
}: StudioProps) {
  const { state, cost, actions } = useStudio(initialBalance, presetAvailability, { jewelleryType, photoSize: initialPhotoSize });
  const { phase, source, job, preset, photoSize, instructions, balance, error, busyAction, history } = state;
  const [styleTouched, setStyleTouched] = React.useState(false);

  const choosePreset = (slug: PresetSlug) => {
    setStyleTouched(true);
    actions.setPreset(slug);
  };
  const choosePhotoSize = (id: PhotoSizeId) => {
    actions.setPhotoSize(id);
    // Keep the choice in the URL without a server round trip.
    const url = new URL(window.location.href);
    url.searchParams.set("size", id);
    window.history.replaceState(null, "", url);
  };

  const generating = phase === "submitting" || phase === "generating";
  const insufficient = balance < cost;
  const remaining = INSTRUCTIONS_MAX_LENGTH - instructions.length;
  const hasResult = phase === "result" && job?.result;
  // Generator steps 2-5: upload, style, photo size, then generate (and review).
  const step = !source ? 2 : job || generating || photoSize ? 5 : styleTouched ? 4 : 3;

  return (
    <>
      <GeneratorSteps current={step} />
      <div className="mb-6 max-w-2xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">Studio</h1>
        <p className="mt-2 text-body text-ink-600">
          Turn one product photo into a clean catalogue image. Review every result before you publish it.
        </p>
      </div>
      <FreeTrialStatus trial={freeTrial} balance={balance} className="mb-6" />
      {jewelleryType && (
        <p className="-mt-2 mb-6 flex flex-wrap items-center gap-2 text-body-sm text-ink-700">
          <span className="text-ink-500">Piece:</span>
          <span className="rounded-full border border-ink-200 bg-surface px-3 py-1 font-medium text-ink-900">{jewelleryTypeById(jewelleryType).name}</span>
          <Link href={`/app/studio?step=type&type=${jewelleryType}`} className="font-medium text-gold-700 underline-offset-4 hover:underline">
            Change
          </Link>
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left: photo and controls */}
        <div className="space-y-6 lg:col-span-5">
          {!providerConfigured && (
            <IntegrationNotice title="Image provider not connected">
              You can upload and check photos, but generation is switched off until{" "}
              <code>OPENAI_API_KEY</code> is set on the server. No images will be generated or simulated. See{" "}
              <code>docs/IMAGE_GENERATION_SETUP.md</code>.
            </IntegrationNotice>
          )}

          {error && (
            <Alert tone="error" live="assertive" title="Something needs attention">
              <p>{error}</p>
              <button type="button" onClick={actions.dismissError} className="mt-1 text-caption font-medium underline">
                Dismiss
              </button>
            </Alert>
          )}

          {!source ? (
            <PhotoDropzone
              onFile={actions.selectFile}
              disabled={phase === "uploading" || phase === "checking"}
              busyLabel={phase === "uploading" ? "Uploading your photo…" : phase === "checking" ? "Checking the photo…" : null}
            />
          ) : (
            <figure className="overflow-hidden rounded-md border border-ink-200 bg-surface-raised">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.url}
                alt={`Your photo: ${source.fileName}`}
                onError={actions.refreshUrls}
                className="aspect-square w-full object-contain"
              />
              <figcaption className="flex items-center justify-between gap-3 border-t border-ink-200 px-3 py-2">
                <span className="min-w-0 truncate text-caption text-ink-700">
                  {source.fileName} · <span className="tabular">{source.width}×{source.height}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={actions.reset} disabled={generating}>
                  <RotateCcw aria-hidden />
                  New photo
                </Button>
              </figcaption>
            </figure>
          )}

          <PresetPicker value={preset} onChange={choosePreset} disabled={generating} availability={presetAvailability} />

          <PhotoSizePicker value={photoSize} onChange={choosePhotoSize} disabled={generating} />

          <div>
            <label htmlFor="instructions" className="text-heading-sm font-semibold text-ink-900">
              Notes for the editor <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <p id="instructions-hint" className="mt-1 text-body-sm text-ink-600">
              About the background or lighting only, e.g. “slightly warmer light” or “more space on the left”. Notes can’t
              change the jewellery itself.
            </p>
            <Textarea
              id="instructions"
              value={instructions}
              maxLength={INSTRUCTIONS_MAX_LENGTH}
              onChange={(e) => actions.setInstructions(e.target.value)}
              aria-describedby="instructions-hint instructions-count"
              disabled={generating}
              rows={3}
              className="mt-2"
            />
            <p id="instructions-count" className="mt-1 text-right text-caption text-ink-500 tabular" aria-live="polite">
              {remaining} characters left
            </p>
          </div>

          <div className="rounded-md border border-ink-200 bg-surface p-4">
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-ink-600">Cost</span>
              <span className="font-medium text-ink-900 tabular">
                {cost} {cost === 1 ? "credit" : "credits"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-body-sm">
              <span className="text-ink-600">Balance after</span>
              <span className={insufficient ? "font-medium text-error-fg tabular" : "text-ink-900 tabular"}>
                {Math.max(0, balance - cost)} of {balance}
              </span>
            </div>
            <Button
              size="lg"
              className="mt-4 w-full"
              onClick={actions.generate}
              disabled={!providerConfigured || !source || !photoSize || insufficient || generating || phase === "checking"}
              loading={phase === "submitting"}
              loadingLabel="Starting…"
            >
              {hasResult ? "Generate another version" : "Generate"}
            </Button>
            <p className="mt-2 text-caption text-ink-500">
              {!providerConfigured
                ? "Generation is disabled until the image provider is connected."
                : !photoSize
                  ? "Choose a photo size above to continue."
                  : insufficient
                  ? "Not enough credits for this style."
                  : `Credits are returned automatically if a generation fails.${providerLabel ? ` Uses ${providerLabel}.` : ""}`}
            </p>
          </div>
        </div>

        {/* Right: status and result */}
        <div className="space-y-6 lg:col-span-7">
          {generating && job && (
            <GenerationStatus
              status={phase === "submitting" ? "submitting" : job.status}
              since={job.createdAt}
              presetName={PRESETS[job.presetSlug].name}
            />
          )}
          {phase === "submitting" && !job && (
            <GenerationStatus status="submitting" since={null} presetName={PRESETS[preset].name} />
          )}

          {hasResult && job?.result && (
            <ResultReview
              job={{ ...job, result: job.result }}
              downloadHref={studioApi.downloadHref(job.id)}
              regenerateCost={cost}
              busyAction={busyAction}
              regenerating={false}
              onApprove={() => actions.review("approved")}
              onDiscard={() => actions.review("discarded")}
              onRegenerate={actions.generate}
              onImageError={actions.refreshUrls}
            />
          )}

          {phase === "failed" && job?.error && (
            <Alert tone="error" title="This generation didn’t work">
              <p>{job.error.message}</p>
              {job.creditsRefunded && <p className="mt-1">Your {job.creditsCharged} {job.creditsCharged === 1 ? "credit was" : "credits were"} returned.</p>}
            </Alert>
          )}

          {!generating && !hasResult && phase !== "failed" && (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-md border border-ink-200 bg-surface p-8 text-center">
              <p className="font-serif text-display-sm text-ink-900">Your edited photo will appear here</p>
              <p className="mt-2 max-w-sm text-body-sm text-ink-600">
                Upload a photo, choose a style, then generate. You’ll see the original and the edit side by side.
              </p>
              <div className="mt-6 w-full max-w-md text-left">
                <FidelityWarning compact />
              </div>
            </div>
          )}

          {history.length > 0 && (
            <section aria-labelledby="history-title">
              <h2 id="history-title" className="text-heading-sm font-semibold text-ink-900">
                Earlier versions of this photo
              </h2>
              <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {history.map((h) =>
                  h.result ? (
                    <li key={h.id}>
                      <a
                        href={studioApi.downloadHref(h.id)}
                        className="block overflow-hidden rounded-xs border border-ink-200 bg-surface-raised"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={h.result.url} alt={`${PRESETS[h.presetSlug].name} version — download`} className="aspect-square w-full object-cover" />
                      </a>
                      <p className="mt-1 text-caption text-ink-600">{PRESETS[h.presetSlug].name}</p>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

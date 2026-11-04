"use client";

import * as React from "react";

import type { GenerationView } from "@/lib/api-types";
import type { JewelleryTypeId } from "@/lib/jewellery-types";
import type { PhotoSizeId } from "@/lib/photo-sizes";
import { defaultAvailability, firstUsablePreset, type PresetAvailability, type PresetSlug } from "@/lib/presets";
import { supabaseBrowser } from "@/lib/supabase/browser";

import { ApiError, studioApi } from "./api-client";
import { precheckFile } from "./client-validation";

export type StudioPhase =
  | "empty"
  | "uploading"
  | "checking"
  | "ready"
  | "submitting"
  | "generating"
  | "result"
  | "failed";

export interface StudioState {
  phase: StudioPhase;
  source: GenerationView["source"] | null;
  job: GenerationView | null;
  /** Earlier results for the current photo, newest first. */
  history: GenerationView[];
  preset: PresetSlug;
  /** Step 4. Null until chosen; generation waits for it. */
  photoSize: PhotoSizeId | null;
  instructions: string;
  balance: number;
  error: string | null;
  busyAction: "approve" | "discard" | null;
}

const ACTIVE = new Set(["queued", "processing"]);

function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * All studio behaviour lives here; components only render state and call
 * these actions. Nothing here simulates progress or results — every state
 * change comes from a server response.
 */
export function useStudio(
  initialBalance: number,
  availability: PresetAvailability = defaultAvailability(),
  options: { jewelleryType?: JewelleryTypeId | null; photoSize?: PhotoSizeId | null } = {},
) {
  const jewelleryType = options.jewelleryType ?? null;
  const [state, setState] = React.useState<StudioState>({
    phase: "empty",
    source: null,
    job: null,
    history: [],
    preset: firstUsablePreset(availability),
    photoSize: options.photoSize ?? null,
    instructions: "",
    balance: initialBalance,
    error: null,
    busyAction: null,
  });
  const pendingKeyRef = React.useRef<string | null>(null);
  const cancelPollRef = React.useRef<(() => void) | null>(null);

  const patch = React.useCallback((p: Partial<StudioState>) => setState((s) => ({ ...s, ...p })), []);

  React.useEffect(() => () => cancelPollRef.current?.(), []);

  const refreshBalance = React.useCallback(async () => {
    try {
      const { balance } = await studioApi.credits();
      patch({ balance });
    } catch {
      // non-critical
    }
  }, [patch]);

  /* ----------------------------------------------------------- polling */
  /** Polls job status until it finishes. Calling it again cancels the previous loop. */
  const poll = React.useCallback(
    async (jobId: string) => {
      cancelPollRef.current?.();
      let cancelled = false;
      cancelPollRef.current = () => {
        cancelled = true;
      };
      const startedAt = Date.now();
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      while (!cancelled) {
        await wait(Date.now() - startedAt < 60_000 ? 2_500 : 5_000);
        if (cancelled) return;
        try {
          const job = await studioApi.getGeneration(jobId);
          if (cancelled) return;
          if (ACTIVE.has(job.status)) {
            patch({ job });
            continue;
          }
          if (job.status === "succeeded") {
            patch({ job, phase: "result", error: null });
          } else {
            patch({ job, phase: "failed", error: job.error?.message ?? "Generation failed." });
            void refreshBalance();
          }
          return;
        } catch (err) {
          // Keep polling through transient network or server errors.
          if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) continue;
          patch({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't check progress." });
          return;
        }
      }
    },
    [patch, refreshBalance],
  );

  /* ----------------------------------------------------------- upload */
  const selectFile = React.useCallback(
    async (file: File) => {
      const problem = await precheckFile(file);
      if (problem) {
        patch({ error: problem });
        return;
      }
      const supabase = supabaseBrowser();
      if (!supabase) {
        patch({ error: "Storage isn't connected yet." });
        return;
      }
      patch({ phase: "uploading", error: null, source: null, job: null, history: [] });
      try {
        const signed = await studioApi.signUpload({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
        const { error } = await supabase.storage
          .from(signed.bucket)
          .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (error) throw new ApiError("internal_error", "The upload didn't finish. Please try again.", 500);
        patch({ phase: "checking" });
        const source = await studioApi.completeUpload(signed.sourceImageId);
        patch({ phase: "ready", source });
      } catch (err) {
        patch({ phase: "empty", error: err instanceof Error ? err.message : "Upload failed." });
      }
    },
    [patch],
  );

  /* --------------------------------------------------------- generate */
  const generate = React.useCallback(async () => {
    const { source, preset, photoSize, instructions, job, history } = state;
    if (!source || !photoSize) return;
    // Reuse the key if the previous attempt never got a response, so a retry can't double-charge.
    const key = pendingKeyRef.current ?? newIdempotencyKey();
    pendingKeyRef.current = key;
    const previous = job && job.result ? [job, ...history] : history;
    patch({ phase: "submitting", error: null });
    try {
      const res = await studioApi.createGeneration(
        {
          sourceImageId: source.id,
          presetSlug: preset,
          instructions: instructions.trim() || undefined,
          photoSize,
          jewelleryType: jewelleryType ?? undefined,
        },
        key,
      );
      pendingKeyRef.current = null;
      patch({ job: res.job, balance: res.balance, history: previous, phase: "generating" });
      void poll(res.job.id);
    } catch (err) {
      const definitive = err instanceof ApiError && err.status >= 400 && err.status < 500;
      if (definitive) pendingKeyRef.current = null;
      patch({
        phase: job?.result ? "result" : "ready",
        error: err instanceof Error ? err.message : "Couldn't start generation.",
      });
    }
  }, [state, patch, poll, jewelleryType]);

  /* ----------------------------------------------------------- review */
  const review = React.useCallback(
    async (decision: "approved" | "discarded") => {
      if (!state.job) return;
      patch({ busyAction: decision === "approved" ? "approve" : "discard", error: null });
      try {
        const job = await studioApi.review(state.job.id, { decision });
        if (decision === "discarded") {
          patch({ job: null, phase: "ready", busyAction: null });
        } else {
          patch({ job, busyAction: null });
        }
      } catch (err) {
        patch({ busyAction: null, error: err instanceof Error ? err.message : "Couldn't save your decision." });
      }
    },
    [state.job, patch],
  );

  /** Signed URLs expire; re-fetch the job to get fresh ones. */
  const refreshUrls = React.useCallback(async () => {
    if (!state.job) return;
    try {
      patch({ job: await studioApi.getGeneration(state.job.id) });
    } catch {
      // ignore
    }
  }, [state.job, patch]);

  const reset = React.useCallback(() => {
    cancelPollRef.current?.();
    pendingKeyRef.current = null;
    patch({ phase: "empty", source: null, job: null, history: [], error: null, instructions: "" });
  }, [patch]);

  return {
    state,
    cost: availability[state.preset].creditCost,
    actions: {
      selectFile,
      setPreset: (preset: PresetSlug) => patch({ preset }),
      setPhotoSize: (photoSize: PhotoSizeId) => patch({ photoSize }),
      setInstructions: (instructions: string) => patch({ instructions }),
      generate,
      review,
      refreshUrls,
      reset,
      dismissError: () => patch({ error: null }),
    },
  };
}

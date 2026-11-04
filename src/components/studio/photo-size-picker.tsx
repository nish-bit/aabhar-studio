"use client";

import { Check } from "lucide-react";

import { PHOTO_SIZES, type PhotoSizeId } from "@/lib/photo-sizes";
import { cn } from "@/lib/utils";

export interface PhotoSizePickerProps {
  value: PhotoSizeId | null;
  onChange: (id: PhotoSizeId) => void;
  disabled?: boolean;
}

/**
 * Step 4: output frame. A radio group of cards; each preview is drawn at the
 * real ratio inside the same box, so the shapes differ just as the photos will.
 */
export function PhotoSizePicker({ value, onChange, disabled = false }: PhotoSizePickerProps) {
  const chosen = PHOTO_SIZES.find((s) => s.id === value) ?? null;
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-heading-sm font-semibold text-ink-900">Photo Size</legend>
      <p className="mt-1 text-body-sm font-medium text-ink-800">Choose your preferred photo frame</p>
      <p className="text-body-sm text-ink-600">Pick the format that suits where the photo will be used: catalogue, social media or marketing.</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        {PHOTO_SIZES.map((s) => {
          const selected = value === s.id;
          // Fit the ratio inside a 64×64 box.
          const scale = 64 / Math.max(s.w, s.h);
          return (
            <label
              key={s.id}
              className={cn(
                "group relative flex cursor-pointer flex-col items-center gap-2 rounded-md border bg-surface p-3 text-center",
                "transition-[border-color,box-shadow,transform] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-600",
                selected
                  ? "border-ink-900 shadow-[var(--shadow-sm)] ring-1 ring-ink-900"
                  : "border-ink-200 hover:border-gold-300 motion-safe:hover:-translate-y-0.5",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input type="radio" name="photo-size" value={s.id} checked={selected} onChange={() => onChange(s.id)} className="sr-only" />
              <span className="flex size-[72px] items-center justify-center" aria-hidden>
                <span
                  className={cn(
                    "rounded-[3px] border-2 transition-colors duration-[var(--duration-base)]",
                    selected ? "border-ink-900 bg-gold-100" : "border-ink-400 bg-surface-sunken group-hover:border-gold-500",
                  )}
                  style={{ width: s.w * scale, height: s.h * scale }}
                />
              </span>
              <span>
                <span className="block text-body-sm font-semibold text-ink-900">{s.name}</span>
                <span className="block text-caption font-medium tabular text-gold-700">
                  {s.id} · {s.orientation}
                </span>
              </span>
              <span className="text-caption text-ink-600">{s.uses}</span>
              {selected && (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-ink-900 text-on-inverse">
                  <Check className="size-3" aria-hidden />
                </span>
              )}
            </label>
          );
        })}
      </div>

      <p className="mt-2 text-caption text-ink-600" aria-live="polite">
        {chosen ? (
          <>
            Selected: <strong className="font-semibold text-ink-900">{chosen.name} {chosen.id}</strong>, delivered at{" "}
            <span className="tabular">
              {chosen.output.width} × {chosen.output.height}
            </span>{" "}
            px.
          </>
        ) : (
          "Choose a size to continue."
        )}
      </p>
    </fieldset>
  );
}

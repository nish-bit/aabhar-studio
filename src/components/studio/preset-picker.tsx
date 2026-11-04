"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { defaultAvailability, PRESET_SLUGS, PRESETS, type PresetAvailability, type PresetSlug } from "@/lib/presets";

export interface PresetPickerProps {
  value: PresetSlug;
  onChange: (slug: PresetSlug) => void;
  disabled?: boolean;
  /** Admin settings and plan access. Switched-off styles are hidden; styles outside the plan are shown but unavailable. */
  availability?: PresetAvailability;
}

/**
 * Radio group of editing styles. Swatches only — no sample photos, so the
 * picker never implies what a result will look like.
 */
export function PresetPicker({ value, onChange, disabled = false, availability = defaultAvailability() }: PresetPickerProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-heading-sm font-semibold text-ink-900">Style</legend>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESET_SLUGS.filter((slug) => availability[slug].enabled).map((slug) => {
          const p = PRESETS[slug];
          const { creditCost, allowed } = availability[slug];
          const selected = value === slug;
          return (
            <label
              key={slug}
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-md border p-3 transition-colors duration-[var(--duration-fast)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-600",
                selected ? "border-ink-900 bg-surface" : "border-ink-200 bg-surface hover:border-ink-300",
                (disabled || !allowed) && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="preset"
                value={slug}
                checked={selected}
                disabled={!allowed}
                onChange={() => onChange(slug)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="h-10 w-full rounded-xs border border-ink-200"
                style={{ background: `linear-gradient(135deg, ${p.swatch.background} 60%, ${p.swatch.accent})` }}
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-body-sm font-semibold text-ink-900">{p.name}</span>
                <span className="text-caption text-ink-500 tabular">
                  {creditCost} {creditCost === 1 ? "credit" : "credits"}
                </span>
              </span>
              <span className="text-caption text-ink-600">{p.description}</span>
              {!allowed && <span className="text-caption font-medium text-gold-700">Buy any credit pack to unlock</span>}
              {selected && (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-ink-900 text-on-inverse">
                  <Check className="size-3" aria-hidden />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

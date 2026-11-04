"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff, Maximize2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  STYLE_CATEGORIES,
  styleCategoryLabel,
  type StyleCategoryId,
  type StylePreview,
} from "@/content/style-previews";
import { cn } from "@/lib/utils";

/**
 * Filterable grid of style previews, each in its own frame. Clicking a card
 * opens it larger in a dialog with previous/next (buttons or arrow keys),
 * moving through the photos in the current filter. Never leaves the page.
 */

// Frame treatments, cycled across the grid so neighbouring cards differ.
const FRAMES = [
  // Rounded luxury
  {
    outer:
      "rounded-xl border border-gold-200 bg-surface p-2 shadow-[var(--shadow-sm)]",
    inner: "rounded-lg",
  },
  // Minimal white border
  {
    outer: "rounded-md border border-ink-200 bg-white p-3",
    inner: "rounded-xs",
  },
  // Soft shadow
  {
    outer: "rounded-xl bg-surface p-0 shadow-[var(--shadow-md)]",
    inner: "rounded-xl",
  },
  // Editorial: dark hairline with a gold inset
  {
    outer: "rounded-xs border border-ink-900 bg-surface p-1.5",
    inner: "rounded-none ring-1 ring-inset ring-gold-300",
  },
  // Ivory mount
  {
    outer:
      "rounded-lg border border-gold-100 bg-gold-50 p-3.5 shadow-[var(--shadow-sm)]",
    inner: "rounded-sm",
  },
] as const;

export function StyleGallery({
  previews,
  filters = true,
}: {
  previews: StylePreview[];
  filters?: boolean;
}) {
  const [category, setCategory] = React.useState<StyleCategoryId | "all">(
    "all",
  );
  const [open, setOpen] = React.useState<number | null>(null);

  const shown =
    category === "all"
      ? previews
      : previews.filter((p) => p.category === category);
  const current = open === null ? null : shown[open];
  const step = (delta: number) =>
    setOpen((i) =>
      i === null ? i : (i + delta + shown.length) % shown.length,
    );

  return (
    <div>
      {filters && (
        <div
          role="group"
          aria-label="Filter by jewellery type"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {STYLE_CATEGORIES.map((c) => {
            const count =
              c.id === "all"
                ? previews.length
                : previews.filter((p) => p.category === c.id).length;
            if (count === 0) return null;
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-body-sm font-medium transition-colors duration-[var(--duration-base)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600",
                  active
                    ? "border-ink-900 bg-ink-900 text-on-inverse"
                    : "border-ink-200 bg-surface text-ink-700 hover:border-gold-300 hover:text-ink-900",
                )}
              >
                {c.label}
                <span
                  className={cn(
                    "ml-1.5 tabular",
                    active ? "text-on-inverse/70" : "text-ink-400",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {filters && (
        <p className="sr-only" aria-live="polite">
          Showing {shown.length} {shown.length === 1 ? "style" : "styles"}
        </p>
      )}

      <ul
        className={cn(
          filters && "mt-8",
          "grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4 lg:gap-8",
        )}
      >
        {shown.map((p, i) => {
          const frame = FRAMES[previews.indexOf(p) % FRAMES.length]!;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-label={`View ${p.name} larger`}
                className="group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-600"
              >
                <span
                  className={cn(
                    "block transition-[transform,box-shadow] duration-[var(--duration-slow)] ease-[var(--ease-standard)]",
                    "motion-safe:group-hover:-translate-y-1 group-hover:shadow-[var(--shadow-lg)]",
                    frame.outer,
                  )}
                >
                  <span
                    className={cn(
                      "relative block aspect-[4/5] overflow-hidden",
                      frame.inner,
                    )}
                  >
                    <PreviewImage
                      preview={p}
                      sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                      eager={i < 4}
                      className="object-cover transition-[transform,opacity] duration-[600ms] ease-[var(--ease-enter)] motion-safe:group-hover:scale-105"
                    />
                    <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-surface/85 text-ink-700 opacity-0 shadow-[var(--shadow-sm)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Maximize2 className="size-4" aria-hidden />
                    </span>
                  </span>
                </span>
                <span className="mt-3 block px-0.5">
                  <Badge tone="gold">{styleCategoryLabel(p.category)}</Badge>
                  <span className="mt-1.5 block font-serif text-heading-sm font-semibold text-ink-900">
                    {p.name}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={current != null} onOpenChange={(o) => !o && setOpen(null)}>
        {current && (
          <DialogContent
            wide
            className="max-w-3xl overflow-hidden p-0"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") step(1);
              if (e.key === "ArrowLeft") step(-1);
            }}
          >
            <div className="flex items-start justify-between gap-4 p-5 pr-14">
              <div>
                <DialogTitle className="font-serif text-heading-lg">
                  {current.name}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {styleCategoryLabel(current.category)} · {open! + 1} of{" "}
                  {shown.length}
                </DialogDescription>
              </div>
            </div>
            <div className="relative mx-5 mb-5 min-h-0 flex-1 rounded-lg border border-gold-200 bg-gold-50 p-2 sm:p-3">
              <div className="relative h-[min(62dvh,640px)] overflow-hidden rounded-md bg-surface-sunken">
                <PreviewImage
                  key={current.id}
                  preview={current}
                  sizes="(min-width: 768px) 720px, 100vw"
                  eager
                  className="object-contain transition-opacity duration-300"
                />
              </div>
              {shown.length > 1 && (
                <>
                  <NavButton
                    side="left"
                    label="Previous style"
                    onClick={() => step(-1)}
                  />
                  <NavButton
                    side="right"
                    label="Next style"
                    onClick={() => step(1)}
                  />
                </>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function NavButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-ink-200 bg-surface/90 text-ink-900 shadow-[var(--shadow-md)] backdrop-blur",
        "hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/** next/image with a shimmer while loading and a quiet fallback if the photo can't be fetched. */
function PreviewImage({
  preview,
  sizes,
  eager,
  className,
}: {
  preview: StylePreview;
  sizes: string;
  eager?: boolean;
  className?: string;
}) {
  const [state, setState] = React.useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  if (state === "failed") {
    return (
      <span
        role="img"
        aria-label={preview.alt}
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-sunken text-ink-400"
      >
        <ImageOff className="size-6" aria-hidden />
        <span className="text-caption">Preview unavailable</span>
      </span>
    );
  }
  return (
    <>
      {state === "loading" && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-surface-sunken"
        />
      )}
      <Image
        src={preview.src}
        alt={preview.alt}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={cn(className, state === "loading" && "opacity-0")}
      />
    </>
  );
}

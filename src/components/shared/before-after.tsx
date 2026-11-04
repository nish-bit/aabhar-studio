"use client";

import * as React from "react";
import Image from "next/image";
import { animate, useReducedMotion } from "motion/react";
import { MoveHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ComparisonImage {
  src: string;
  alt: string;
}

export interface BeforeAfterProps {
  before: ComparisonImage;
  after: ComparisonImage;
  beforeLabel?: string;
  afterLabel?: string;
  /** Starting handle position, 0–100 (percent of width showing "before"). */
  initialPosition?: number;
  /** Play one gentle sweep on first view. Skipped for reduced motion. */
  introSweep?: boolean;
  /** CSS aspect-ratio of the frame. */
  aspect?: string;
  sizes: string;
  eager?: boolean;
  /**
   * Skip the Next.js image optimiser. Required for private, signed URLs so
   * customer images are never cached by the optimiser.
   */
  unoptimized?: boolean;
  /** Accessible name for the slider. */
  label?: string;
  onPositionChange?: (position: number) => void;
  className?: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Draggable before/after comparison.
 * - Pointer: drag anywhere on the image.
 * - Keyboard: ← → move 5%, Shift moves 10%, Home/End jump to the edges.
 * - Screen readers: exposed as a slider with a spoken value.
 */
export function BeforeAfter({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  initialPosition = 50,
  introSweep = false,
  aspect = "1 / 1",
  sizes,
  eager = false,
  unoptimized = false,
  label = "Comparison slider",
  onPositionChange,
  className,
}: BeforeAfterProps) {
  const [position, setPosition] = React.useState(clamp(initialPosition));
  const [dragging, setDragging] = React.useState(false);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const sweepRef = React.useRef<{ stop: () => void } | null>(null);
  const interactedRef = React.useRef(false);
  const reduceMotion = useReducedMotion();

  const update = React.useCallback(
    (next: number) => {
      const value = clamp(next);
      setPosition(value);
      onPositionChange?.(value);
    },
    [onPositionChange],
  );

  const stopSweep = () => {
    interactedRef.current = true;
    sweepRef.current?.stop();
    sweepRef.current = null;
  };

  // One gentle sweep the first time the slider scrolls into view.
  React.useEffect(() => {
    if (!introSweep || reduceMotion) return;
    const node = frameRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || interactedRef.current) return;
        observer.disconnect();
        const start = clamp(initialPosition);
        sweepRef.current = animate(start, [start, start - 18, start + 18, start], {
          duration: 2.2,
          ease: [0.2, 0, 0, 1],
          delay: 0.4,
          onUpdate: (v) => setPosition(v),
        });
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      sweepRef.current?.stop();
    };
  }, [introSweep, reduceMotion, initialPosition]);

  const positionFromPointer = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return position;
    return ((clientX - rect.left) / rect.width) * 100;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stopSweep();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    update(positionFromPointer(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    update(positionFromPointer(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 5;
    const keyMap: Record<string, number> = {
      ArrowLeft: position - step,
      ArrowDown: position - step,
      ArrowRight: position + step,
      ArrowUp: position + step,
      PageDown: position - 10,
      PageUp: position + 10,
      Home: 0,
      End: 100,
    };
    const next = keyMap[e.key];
    if (next === undefined) return;
    e.preventDefault();
    stopSweep();
    update(next);
  };

  const rounded = Math.round(position);

  return (
    <div
      ref={frameRef}
      className={cn(
        "group relative isolate select-none overflow-hidden rounded-xs bg-surface-sunken touch-pan-y",
        dragging ? "cursor-grabbing" : "cursor-ew-resize",
        className,
      )}
      style={{ aspectRatio: aspect }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* After (full frame) */}
      <Image
        src={after.src}
        alt={after.alt}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        unoptimized={unoptimized}
        draggable={false}
        className="object-cover"
      />

      {/* Before (clipped to the left of the handle) */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <Image
          src={before.src}
          alt={before.alt}
          fill
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          unoptimized={unoptimized}
          draggable={false}
          className="object-cover"
        />
      </div>

      {/* Corner labels fade out when their side becomes too narrow */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-3 rounded-xs bg-ink-900/70 px-2 py-1 text-caption font-medium text-on-inverse transition-opacity duration-[var(--duration-base)]"
        style={{ opacity: position > 18 ? 1 : 0 }}
      >
        {beforeLabel}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-3 rounded-xs bg-surface/90 px-2 py-1 text-caption font-medium text-ink-900 transition-opacity duration-[var(--duration-base)]"
        style={{ opacity: position < 82 ? 1 : 0 }}
      >
        {afterLabel}
      </span>

      {/* Divider + handle */}
      <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-gold-300" style={{ left: `${position}%` }}>
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rounded}
          aria-valuetext={`${rounded}% ${beforeLabel.toLowerCase()}, ${100 - rounded}% ${afterLabel.toLowerCase()}`}
          onKeyDown={onKeyDown}
          className={cn(
            "pointer-events-auto absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
            "rounded-full border border-gold-300 bg-surface text-ink-900 shadow-md",
            "transition-transform duration-[var(--duration-fast)] group-hover:scale-105",
            dragging && "scale-105",
          )}
        >
          <MoveHorizontal className="size-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

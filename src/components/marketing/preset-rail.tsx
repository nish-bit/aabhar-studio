"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PresetRailProps {
  /** Accessible name for the scrolling list. */
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Horizontal snap-scrolling rail with previous/next buttons.
 * Touch and trackpad users swipe; keyboard users tab through the cards
 * or use the buttons.
 */
export function PresetRail({ label, children, className }: PresetRailProps) {
  const scrollerRef = React.useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);

  const updateEdges = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className={cn("relative", className)}>
      <div className="mb-6 hidden justify-end gap-2 md:flex">
        <Button variant="secondary" size="icon" onClick={() => scrollByPage(-1)} disabled={!canPrev} aria-label="Previous looks">
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="secondary" size="icon" onClick={() => scrollByPage(1)} disabled={!canNext} aria-label="Next looks">
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <ul
        ref={scrollerRef}
        aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] md:mx-0 md:scroll-px-0 md:px-0 md:gap-6 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
    </div>
  );
}

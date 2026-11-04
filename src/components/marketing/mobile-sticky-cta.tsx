"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MobileStickyCtaProps {
  label: string;
  href: string;
  /** id of the element whose visibility hides this bar (the hero CTA). */
  watchId: string;
}

/** Bottom CTA bar on phones and tablets, shown once the hero CTA scrolls away. */
export function MobileStickyCta({ label, href, watchId }: MobileStickyCtaProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-canvas/95 p-3 backdrop-blur-sm transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] lg:hidden",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full",
      )}
      aria-hidden={!visible}
      inert={!visible}
    >
      <Button asChild size="lg" className="w-full">
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}

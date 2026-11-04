import * as React from "react";

import { cn } from "@/lib/utils";

const widths = {
  /** Marketing content, max 1200px. */
  marketing: "max-w-[1200px]",
  /** App content, max 1440px. */
  app: "max-w-[1440px]",
  narrow: "max-w-3xl",
} as const;

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof widths;
}

/** Horizontal page container with the responsive outer margins from the grid spec. */
export function Container({ width = "marketing", className, ...props }: ContainerProps) {
  return <div className={cn("mx-auto w-full px-4 md:px-6 lg:px-8 xl:px-12", widths[width], className)} {...props} />;
}

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  tone?: "canvas" | "surface" | "inverse";
}

/** Marketing section with the 64 / 80 / 128px vertical rhythm. */
export function Section({ tone = "canvas", className, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        "py-16 md:py-20 lg:py-32",
        tone === "surface" && "bg-surface",
        tone === "inverse" && "bg-surface-inverse text-on-inverse",
        className,
      )}
      {...props}
    />
  );
}

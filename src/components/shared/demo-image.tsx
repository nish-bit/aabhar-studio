import Image from "next/image";

import { cn } from "@/lib/utils";
import type { DemoImage as DemoImageData } from "@/types/content";

import { ProvenanceLabel } from "./provenance-label";

export interface DemoImageProps {
  image: DemoImageData;
  /** CSS aspect-ratio for the frame, e.g. "1 / 1" or "4 / 5". */
  aspect?: string;
  sizes: string;
  /** Load eagerly with high fetch priority (above-the-fold images). */
  eager?: boolean;
  showLabel?: boolean;
  className?: string;
  imageClassName?: string;
}

/** Jewellery image in a fixed-ratio frame with its provenance label. */
export function DemoImage({
  image,
  aspect = "1 / 1",
  sizes,
  eager = false,
  showLabel = true,
  className,
  imageClassName,
}: DemoImageProps) {
  return (
    <figure className={cn("relative overflow-hidden rounded-xs bg-surface-sunken", className)} style={{ aspectRatio: aspect }}>
      <Image
        src={image.src}
        alt={image.alt}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        className={cn("object-cover", imageClassName)}
      />
      {showLabel && <ProvenanceLabel image={image} />}
    </figure>
  );
}

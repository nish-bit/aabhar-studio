import { cn } from "@/lib/utils";
import type { DemoImage, ImageProvenance } from "@/types/content";

const labels: Record<ImageProvenance, string> = {
  unsplash: "Photo",
  "user-supplied": "Demo image",
  simulated: "Simulated photo",
};

export interface ProvenanceLabelProps {
  image: Pick<DemoImage, "provenance" | "credit">;
  /** Positions the label over an image corner. */
  overlay?: boolean;
  className?: string;
}

/**
 * Visible label on every demo image, so sample material is never mistaken
 * for customer work or AI output.
 */
export function ProvenanceLabel({ image, overlay = true, className }: ProvenanceLabelProps) {
  const text = image.provenance === "unsplash" && image.credit ? image.credit : labels[image.provenance];
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center rounded-xs px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4 tracking-wide",
        overlay && "absolute bottom-2 left-2 bg-ink-900/70 text-on-inverse backdrop-blur-[2px]",
        !overlay && "bg-ink-100 text-ink-600",
        className,
      )}
    >
      {text}
    </span>
  );
}

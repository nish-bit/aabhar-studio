import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Our custom type scale (`text-body`, `text-display-xl`, …) shares the
 * `text-` prefix with colours (`text-ink-900`). Registering the sizes keeps
 * twMerge from treating a size and a colour as conflicting classes.
 */
const customTextSizes = [
  "display-2xl",
  "display-xl",
  "display-lg",
  "display-md",
  "display-sm",
  "heading-lg",
  "heading-md",
  "heading-sm",
  "body-lg",
  "body",
  "body-sm",
  "caption",
  "overline",
  "numeral-lg",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: customTextSizes }],
    },
  },
});

/** Merge Tailwind class names, letting later classes win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

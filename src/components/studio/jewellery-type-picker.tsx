"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JEWELLERY_TYPES, type JewelleryTypeId } from "@/lib/jewellery-types";
import { cn } from "@/lib/utils";

/**
 * Step 1: pick the kind of piece. A radio group styled as image cards
 * (arrow keys move between them). Continue goes to the existing studio with
 * the choice in the URL, so it survives reloads and the Back button.
 */
export function JewelleryTypePicker({ initial }: { initial: JewelleryTypeId | null }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<JewelleryTypeId | null>(initial);
  const [going, setGoing] = React.useState(false);

  const next = () => {
    if (!selected) return;
    setGoing(true);
    router.push(`/app/studio?type=${selected}`);
  };

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Jewellery type</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:gap-5">
          {JEWELLERY_TYPES.map((t, i) => {
            const isSelected = selected === t.id;
            return (
              <label
                key={t.id}
                className={cn(
                  "group relative cursor-pointer overflow-hidden rounded-md border bg-surface",
                  "transition-[border-color,box-shadow,transform] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-600",
                  isSelected
                    ? "border-ink-900 shadow-[var(--shadow-md)] ring-1 ring-ink-900"
                    : "border-ink-200 hover:border-gold-300 hover:shadow-[var(--shadow-sm)] motion-safe:hover:-translate-y-0.5",
                )}
              >
                <input
                  type="radio"
                  name="jewellery-type"
                  value={t.id}
                  checked={isSelected}
                  onChange={() => setSelected(t.id)}
                  className="sr-only"
                />
                <span className="relative block aspect-[4/3] overflow-hidden bg-surface-sunken">
                  <Image
                    src={t.image.src}
                    alt={t.image.alt}
                    fill
                    sizes="(min-width: 1280px) 300px, (min-width: 640px) 30vw, 46vw"
                    loading={i < 3 ? "eager" : "lazy"}
                    className="object-cover transition-transform duration-[var(--duration-slow)] motion-safe:group-hover:scale-[1.03]"
                  />
                  {isSelected && (
                    <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-ink-900 text-on-inverse shadow-[var(--shadow-sm)]">
                      <Check className="size-4" aria-hidden />
                    </span>
                  )}
                </span>
                <span className="block p-3 sm:p-4">
                  <span className="block font-serif text-heading-md font-semibold text-ink-900">{t.name}</span>
                  <span className="mt-0.5 block text-body-sm text-ink-600">{t.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-4 mt-6 border-t border-ink-200 bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0",
          !selected && "hidden",
        )}
      >
        <Button size="lg" className="w-full sm:w-auto" onClick={next} loading={going} loadingLabel="Opening…">
          Continue{selected ? ` with ${JEWELLERY_TYPES.find((t) => t.id === selected)!.name}` : ""}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

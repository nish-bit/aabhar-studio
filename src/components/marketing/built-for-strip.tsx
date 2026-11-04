import { Container } from "@/components/shared/container";

export interface BuiltForStripProps {
  label: string;
  items: string[];
}

/** Quiet strip naming the jewellery the product is designed for. */
export function BuiltForStrip({ label, items }: BuiltForStripProps) {
  return (
    <div className="border-y border-ink-200 bg-surface">
      <Container className="flex flex-col gap-4 py-6 md:flex-row md:items-center md:gap-10">
        <p className="shrink-0 text-overline font-semibold uppercase tracking-[0.12em] text-ink-500">{label}</p>
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          {items.map((item) => (
            <li key={item} className="font-serif text-[1.25rem] leading-7 text-ink-700">
              {item}
            </li>
          ))}
        </ul>
      </Container>
    </div>
  );
}

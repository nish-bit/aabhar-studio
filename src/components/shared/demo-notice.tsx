import { Info } from "lucide-react";

export interface DemoNoticeProps {
  message: string;
}

/**
 * Site-wide strip that marks the build as a preview with sample content.
 * Rendered by the marketing layout while demo data is in use.
 */
export function DemoNotice({ message }: DemoNoticeProps) {
  return (
    <div role="note" className="bg-ink-900 text-on-inverse">
      <p className="mx-auto flex max-w-[1200px] items-center justify-center gap-2 px-4 py-2 text-center text-caption">
        <Info className="size-3.5 shrink-0 text-gold-300" aria-hidden />
        {message}
      </p>
    </div>
  );
}

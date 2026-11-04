import { PlugZap } from "lucide-react";

export interface IntegrationNoticeProps {
  title: string;
  children: React.ReactNode;
}

/** Clearly labelled "not connected" state. Never implies a feature works. */
export function IntegrationNotice({ title, children }: IntegrationNoticeProps) {
  return (
    <div role="status" className="rounded-md border border-dashed border-gold-300 bg-gold-50 p-5">
      <div className="flex gap-3">
        <PlugZap className="mt-0.5 size-5 shrink-0 text-gold-700" aria-hidden />
        <div className="space-y-1.5">
          <p className="text-overline font-semibold uppercase tracking-[0.12em] text-gold-700">Integration-ready</p>
          <p className="text-heading-sm font-semibold text-ink-900">{title}</p>
          <div className="text-body-sm text-ink-700 [&_code]:[overflow-wrap:anywhere] [&_code]:rounded-xs [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-caption">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

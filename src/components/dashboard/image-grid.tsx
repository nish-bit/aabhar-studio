import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { GalleryItem } from "@/server/dashboard/service";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Generated images with style, date and status. Downloads go through the existing signed-download route. */
export function ImageGrid({ items }: { items: GalleryItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {items.map((img) => (
        <li
          key={img.generatedImageId}
          className="group overflow-hidden rounded-md border border-ink-200 bg-surface transition-[box-shadow,border-color] duration-[var(--duration-base)] hover:border-gold-300 hover:shadow-[var(--shadow-sm)]"
        >
          <div className="relative aspect-square bg-surface-sunken">
            {/* Signed Supabase URLs expire in minutes, so they skip the image optimiser. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={`${img.styleName} result`} loading="lazy" className="size-full object-cover" />
            <a
              href={`/api/generations/${img.jobId}/download`}
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-surface/90 text-ink-900 opacity-100 shadow-[var(--shadow-xs)] transition-opacity hover:bg-surface focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={`Download ${img.styleName} image from ${dateFmt.format(new Date(img.createdAt))}`}
            >
              <Download className="size-4" aria-hidden />
            </a>
          </div>
          <div className="flex items-start justify-between gap-2 p-2.5">
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-ink-900">{img.styleName}</p>
              <p className="text-caption text-ink-500 tabular">{dateFmt.format(new Date(img.createdAt))}</p>
            </div>
            {img.reviewStatus === "approved" ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">To review</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}

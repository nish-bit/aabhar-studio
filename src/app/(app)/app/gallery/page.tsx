import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ImageIcon } from "lucide-react";

import { ImageGrid } from "@/components/dashboard/image-grid";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/server/auth/session";
import { dashboardDeps } from "@/server/dashboard/deps";
import { galleryCursorSchema, listGallery } from "@/server/dashboard/service";

export const metadata = { title: "My gallery" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function GalleryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-8 max-w-2xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">My gallery</h1>
        <p className="mt-2 text-body text-ink-600">
          Every image you&apos;ve created, newest first. Download any of them, or add approved ones to a catalogue. Results you discard
          don&apos;t appear here.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-surface-sunken" aria-busy="true" />}>
        <Gallery searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Gallery({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/gallery");
  const deps = dashboardDeps();
  if (!deps) {
    return (
      <IntegrationNotice title="Gallery not connected">
        Set <code>DATABASE_URL</code> and the Supabase keys, and apply the migrations in <code>supabase/migrations</code>.
      </IntegrationNotice>
    );
  }
  const raw = (await searchParams).before;
  const before = typeof raw === "string" && galleryCursorSchema.safeParse(raw).success ? raw : null;
  const { items, nextCursor } = await listGallery(deps, user.id, before);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-ink-300 bg-surface px-6 py-12 text-center">
        <ImageIcon className="size-8 text-ink-400" strokeWidth={1.5} aria-hidden />
        <p className="text-heading-sm font-semibold text-ink-900">{before ? "No older images." : "You haven't created any images yet."}</p>
        <Button asChild className="mt-2">
          <Link href={before ? "/app/gallery" : "/app/studio"}>
            {before ? "Back to newest" : "Create your first image"}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ImageGrid items={items} />
      <nav aria-label="Gallery pages" className="flex flex-wrap justify-between gap-3">
        {before ? (
          <Button asChild variant="ghost">
            <Link href="/app/gallery">Back to newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {nextCursor && (
          <Button asChild variant="secondary">
            <Link href={`/app/gallery?before=${encodeURIComponent(nextCursor)}`}>
              Older images
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </nav>
    </div>
  );
}

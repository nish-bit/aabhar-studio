"use client";

import { Button } from "@/components/ui/button";

/** Shown when a page inside the app fails to load. Your work is saved on the server. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-md border border-error-border bg-error-bg p-6">
      <h1 className="font-serif text-display-sm text-ink-900">This page couldn&apos;t load</h1>
      <p className="mt-2 text-body-sm text-ink-700">
        Please try again. Your photos, credits and catalogues are safe.
        {error.digest ? ` If it keeps happening, quote reference ${error.digest}.` : ""}
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

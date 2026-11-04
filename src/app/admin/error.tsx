"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Shown when an admin page fails to load (e.g. the database is unreachable). */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-md border border-error-border bg-error-bg p-6">
      <h1 className="font-serif text-display-sm text-ink-900">This admin page couldn&apos;t load</h1>
      <p className="mt-2 text-body-sm text-ink-700">
        The data source may be unavailable or misconfigured. Nothing was changed.
        {error.digest ? ` Reference: ${error.digest}` : ""}
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

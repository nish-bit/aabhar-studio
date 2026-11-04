"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ImagePlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { catalogueApi } from "@/features/catalogues/api-client";
import type { ApprovedImageView } from "@/lib/catalogue";
import { cn } from "@/lib/utils";

export interface AddImagesDialogProps {
  alreadyAdded: Set<string>;
  onAdd: (ids: string[]) => Promise<{ added: number; rejected: number }>;
  disabled?: boolean;
}

/** Pick approved images from the user's own projects. */
export function AddImagesDialog({ alreadyAdded, onAdd, disabled }: AddImagesDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [images, setImages] = React.useState<ApprovedImageView[] | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setSelected([]);
    setError(null);
    setImages(null);
    catalogueApi.approvedImages().then(setImages, (e: Error) => setError(e.message));
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(selected);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add images.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <ImagePlus aria-hidden /> Add approved images
        </Button>
      </DialogTrigger>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Add approved images</DialogTitle>
          <DialogDescription>Only images you approved in the Studio can go into a catalogue. They’re added in the order you select them.</DialogDescription>
        </DialogHeader>
        <div className="min-h-48 flex-1 overflow-y-auto px-6 pb-4">
          {error && <Alert tone="error" live="assertive">{error}</Alert>}
          {!images && !error && (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-busy="true">
              {Array.from({ length: 10 }, (_, i) => <li key={i} className="aspect-square animate-pulse rounded-xs bg-surface-sunken" />)}
            </ul>
          )}
          {images && images.length === 0 && (
            <div className="py-10 text-center">
              <p className="font-serif text-display-sm text-ink-900">No approved images yet</p>
              <p className="mt-2 text-body-sm text-ink-600">Generate and approve images in the Studio first.</p>
              <Button asChild variant="secondary" className="mt-4"><Link href="/app/studio">Open Studio</Link></Button>
            </div>
          )}
          {images && images.length > 0 && (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {images.map((img) => {
                const added = alreadyAdded.has(img.generatedImageId);
                const order = selected.indexOf(img.generatedImageId);
                return (
                  <li key={img.generatedImageId}>
                    <button
                      type="button"
                      disabled={added}
                      aria-pressed={order >= 0}
                      aria-label={`${img.fileName}${added ? " (already in catalogue)" : ""}`}
                      onClick={() => toggle(img.generatedImageId)}
                      className={cn(
                        "relative block w-full overflow-hidden rounded-xs border-2 bg-surface-raised transition-colors",
                        order >= 0 ? "border-ink-900" : "border-transparent hover:border-ink-300",
                        added && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="aspect-square w-full object-contain" />
                      {order >= 0 && (
                        <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-ink-900 text-caption font-semibold text-on-inverse tabular">
                          {order + 1}
                        </span>
                      )}
                      {added && (
                        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-ink-900/70 py-1 text-caption text-on-inverse">
                          <Check className="size-3" aria-hidden /> Added
                        </span>
                      )}
                    </button>
                    <p className="mt-1 truncate text-caption text-ink-600">{img.fileName}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-body-sm text-ink-600 tabular">{selected.length} selected</span>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={add} disabled={selected.length === 0} loading={busy} loadingLabel="Adding…">
            Add {selected.length > 0 ? selected.length : ""} {selected.length === 1 ? "image" : "images"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

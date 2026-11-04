"use client";

import * as React from "react";
import { ImageUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { UPLOAD_LIMITS, formatMegabytes } from "@/lib/upload-limits";

export interface PhotoDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  busyLabel?: string | null;
}

/** Drag-and-drop or click/keyboard to choose one product photo. */
export function PhotoDropzone({ onFile, disabled = false, busyLabel = null }: PhotoDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const hintId = React.useId();

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex min-h-72 flex-col items-center justify-center gap-4 rounded-md border-[1.5px] border-dashed p-8 text-center transition-colors duration-[var(--duration-base)]",
        dragOver ? "border-gold-600 bg-gold-50" : "border-ink-300 bg-surface-sunken",
        disabled && "opacity-70",
      )}
    >
      <ImageUp className={cn("size-8", dragOver ? "text-gold-600" : "text-ink-500")} strokeWidth={1.5} aria-hidden />
      {busyLabel ? (
        <p role="status" aria-live="polite" className="text-body font-medium text-ink-900">
          <span className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-gold-400 border-t-transparent align-[-1px]" aria-hidden />
          {busyLabel}
        </p>
      ) : (
        <>
          <div>
            <p className="text-heading-sm font-semibold text-ink-900">
              {dragOver ? "Release to upload" : "Drop a product photo here"}
            </p>
            <p id={hintId} className="mt-1 text-body-sm text-ink-600">
              JPG, PNG or WebP · up to {formatMegabytes(UPLOAD_LIMITS.maxBytes)}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            aria-describedby={hintId}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-10 items-center rounded-sm border border-ink-300 bg-surface px-4 text-body font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:pointer-events-none"
          >
            Choose photo
          </button>
          <p className="max-w-sm text-caption text-ink-500">
            Best results: one piece per photo, daylight, plain cloth underneath, the piece filling most of the frame.
          </p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_LIMITS.acceptedMimeTypes.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

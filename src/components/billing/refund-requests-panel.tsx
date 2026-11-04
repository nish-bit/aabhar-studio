"use client";

import * as React from "react";
import { Check, ImageOff } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { billingApi } from "@/features/billing/api-client";
import type { RefundableImage, RefundRequestView } from "@/lib/support-types";
import { cn } from "@/lib/utils";

const STATUS: Record<RefundRequestView["status"], { tone: "warning" | "success" | "neutral"; label: string }> = {
  pending: { tone: "warning", label: "Being reviewed" },
  approved: { tone: "success", label: "Credits returned" },
  rejected: { tone: "neutral", label: "Not refunded" },
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** "Refunds": pick the photos that fell short, say why, and follow each request. */
export function RefundRequestsPanel({
  initialRequests,
  initialImages,
  windowDays,
}: {
  initialRequests: RefundRequestView[];
  initialImages: RefundableImage[];
  windowDays: number;
}) {
  const [requests, setRequests] = React.useState(initialRequests);
  const [images, setImages] = React.useState(initialImages);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const credits = images.filter((i) => selected.has(i.generatedImageId)).reduce((n, i) => n + i.creditCost, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await billingApi.createRefundRequest([...selected], reason.trim());
      setRequests(res.requests);
      setImages(res.images);
      setSelected(new Set());
      setReason("");
      setOpen(false);
      setMessage({ tone: "success", text: "Request sent. We'll compare each original with its result and update it here." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't send the request." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="refunds-title" className="space-y-4">
      <div>
        <h2 id="refunds-title" className="font-serif text-display-sm text-ink-900">
          Refunds
        </h2>
        <p className="mt-1 text-body-sm text-ink-600">Point at the photos that fell short and we&apos;ll take a look.</p>
      </div>
      {message && (
        <Alert tone={message.tone} live={message.tone === "error" ? "assertive" : "polite"}>
          {message.text}
        </Alert>
      )}

      <div className="rounded-md border border-ink-200 bg-surface p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-heading-sm font-semibold text-ink-900">A photo didn&apos;t come out right?</h3>
            <p className="mt-1 max-w-2xl text-body-sm text-ink-600">
              Pick the exact photos below and tell us what went wrong. A person looks at your original next to the result and credits you back
              if the output fell short. Failed generations are refunded automatically, so you don&apos;t need to ask for those.
            </p>
          </div>
          {!open && (
            <Button variant="secondary" className="shrink-0" onClick={() => setOpen(true)} disabled={images.length === 0}>
              Request a refund
            </Button>
          )}
        </div>
        {images.length === 0 && !open && (
          <p className="mt-3 text-caption text-ink-500">No photos from the last {windowDays} days to choose from.</p>
        )}

        {open && (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <fieldset>
              <legend className="text-body-sm font-medium text-ink-900">
                Photos from the last {windowDays} days <span className="font-normal text-ink-500">({selected.size} selected)</span>
              </legend>
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {images.map((img) => {
                  const on = selected.has(img.generatedImageId);
                  return (
                    <li key={img.generatedImageId}>
                      <label
                        className={cn(
                          "relative block cursor-pointer overflow-hidden rounded-sm border bg-surface-sunken",
                          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-600",
                          on ? "border-ink-900 ring-1 ring-ink-900" : "border-ink-200 hover:border-gold-300",
                        )}
                      >
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(img.generatedImageId)} />
                        {img.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img.url} alt={`${img.styleName} result from ${date(img.createdAt)}`} className="aspect-square w-full object-cover" />
                        ) : (
                          <span className="flex aspect-square items-center justify-center text-ink-400">
                            <ImageOff className="size-5" aria-hidden />
                          </span>
                        )}
                        <span className="block truncate px-1.5 py-1 text-caption text-ink-700">{img.styleName}</span>
                        {on && (
                          <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-ink-900 text-on-inverse">
                            <Check className="size-3" aria-hidden />
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <div>
              <label htmlFor="refund-reason" className="text-body-sm font-medium text-ink-900">
                What went wrong?
              </label>
              <Textarea
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                className="mt-1"
                placeholder="e.g. The stones changed colour, and one earring is missing its drop."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={saving} loadingLabel="Sending…" disabled={selected.size === 0 || reason.trim().length < 10}>
                Send request{credits ? ` (${credits} ${credits === 1 ? "credit" : "credits"})` : ""}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      {requests.length > 0 && (
        <ul className="space-y-3" aria-label="Your refund requests">
          {requests.map((r) => (
            <li key={r.id} className="rounded-md border border-ink-200 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-sm text-ink-700">
                  Sent {date(r.createdAt)} · {r.creditsRequested} {r.creditsRequested === 1 ? "credit" : "credits"}
                  {r.status === "approved" && ` · ${r.creditsReturned} returned`}
                </p>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-ink-900">{r.reason}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.images.map((i) =>
                  i.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i.generatedImageId} src={i.url} alt={`${i.styleName} result`} className="size-14 rounded-xs border border-ink-200 object-cover" />
                  ) : (
                    <span key={i.generatedImageId} className="flex size-14 items-center justify-center rounded-xs border border-ink-200 text-ink-400">
                      <ImageOff className="size-4" aria-hidden />
                    </span>
                  ),
                )}
              </div>
              {r.adminNote && (
                <p className="mt-3 rounded-sm bg-surface-sunken p-3 text-body-sm text-ink-800">
                  <span className="font-medium">Our reply:</span> {r.adminNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

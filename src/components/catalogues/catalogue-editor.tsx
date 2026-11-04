"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, CloudOff, Download, Eye, FileDown, Loader2, RefreshCw } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, catalogueApi } from "@/features/catalogues/api-client";
import { useCatalogueEditor, type SaveState } from "@/features/catalogues/use-catalogue-editor";
import { CATALOGUE_LIMITS, type CatalogueExportView, type CatalogueView } from "@/lib/catalogue";
import { cn } from "@/lib/utils";

import { AddImagesDialog } from "./add-images-dialog";
import { ProductEditor } from "./product-editor";

export interface CatalogueEditorProps {
  initial: CatalogueView;
  canEdit: boolean;
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { icon: React.ReactNode; text: string; className: string }> = {
    saved: { icon: <Check className="size-3.5" aria-hidden />, text: "Draft saved", className: "text-success-fg" },
    unsaved: { icon: <span className="size-1.5 rounded-full bg-gold-500" aria-hidden />, text: "Unsaved changes", className: "text-ink-600" },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, text: "Saving…", className: "text-ink-600" },
    error: { icon: <CloudOff className="size-3.5" aria-hidden />, text: "Not saved", className: "text-error-fg" },
    conflict: { icon: <AlertTriangle className="size-3.5" aria-hidden />, text: "Changed elsewhere", className: "text-warning-fg" },
  };
  const m = map[state];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-body-sm", m.className)}>
      {m.icon}
      {m.text}
    </span>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-caption font-medium text-ink-700">{label}</legend>
      <div className="mt-1 inline-flex w-full rounded-sm border border-ink-300 p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex h-9 flex-1 cursor-pointer items-center justify-center rounded-xs text-body-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold-600",
              value === o.value ? "bg-ink-900 text-on-inverse" : "text-ink-700 hover:bg-ink-100",
            )}
          >
            <input type="radio" className="sr-only" name={label} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink-900)]" />
      <label htmlFor={id} className="text-body-sm">
        <span className="font-medium text-ink-900">{label}</span>
        {hint && <span className="block text-caption text-ink-500">{hint}</span>}
      </label>
    </div>
  );
}

const formatBytes = (n: number) => (n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export function CatalogueEditor({ initial, canEdit }: CatalogueEditorProps) {
  const { catalogue: c, saveState, error, previewKey, actions } = useCatalogueEditor(initial);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState<"pdf" | "images_zip" | null>(null);
  const [lastExport, setLastExport] = React.useState<CatalogueExportView | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const alreadyAdded = React.useMemo(() => new Set(c.items.map((i) => i.generatedImageId).filter((x): x is string => !!x)), [c.items]);

  const openPreview = async () => {
    await actions.refreshPreview();
    setPreviewOpen(true);
  };

  const doExport = async (kind: "pdf" | "images_zip") => {
    setExporting(kind);
    setExportError(null);
    try {
      await actions.flush();
      const result = await catalogueApi.exportFile(c.id, kind);
      setLastExport(result);
      window.location.assign(result.url);
    } catch (e) {
      setExportError(e instanceof ApiError || e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to catalogues">
            <Link href="/app/catalogues"><ArrowLeft aria-hidden /></Link>
          </Button>
          <div className="min-w-0">
            <label htmlFor="cat-name" className="sr-only">Catalogue name</label>
            <input
              id="cat-name"
              value={c.name}
              maxLength={CATALOGUE_LIMITS.nameMax}
              disabled={!canEdit}
              onChange={(e) => actions.updateSettings({ name: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && actions.updateSettings({ name: "Untitled catalogue" })}
              className="w-full max-w-xl truncate rounded-xs bg-transparent font-serif text-display-sm font-medium text-ink-900 hover:bg-ink-100 focus-visible:bg-surface"
            />
            <SaveIndicator state={saveState} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openPreview} disabled={c.items.length === 0}>
            <Eye aria-hidden /> Preview
          </Button>
          <Button variant="secondary" onClick={() => doExport("images_zip")} loading={exporting === "images_zip"} loadingLabel="Preparing…" disabled={!!exporting || c.items.length === 0}>
            <Download aria-hidden /> Images (.zip)
          </Button>
          <Button onClick={() => doExport("pdf")} loading={exporting === "pdf"} loadingLabel="Building PDF…" disabled={!!exporting || c.items.length === 0}>
            <FileDown aria-hidden /> Export PDF
          </Button>
        </div>
      </div>

      {(error || saveState === "conflict") && (
        <Alert tone={saveState === "conflict" ? "warning" : "error"} live="assertive" title={saveState === "conflict" ? "This catalogue changed in another window" : "Your last change wasn't saved"}>
          <p>{error}</p>
          <div className="mt-2 flex gap-3">
            {saveState === "conflict" ? (
              <button type="button" className="font-medium underline" onClick={() => void actions.reload()}>Reload latest version</button>
            ) : (
              <button type="button" className="font-medium underline" onClick={() => void actions.flush()}>Try again</button>
            )}
          </div>
        </Alert>
      )}
      {exportError && <Alert tone="error" live="assertive" title="Export failed">{exportError}</Alert>}
      {lastExport && (
        <Alert tone="success" title={lastExport.kind === "pdf" ? "PDF ready" : "Images ready"}>
          <p>
            {lastExport.kind === "pdf" ? `${lastExport.pageCount} pages · ` : ""}
            {formatBytes(lastExport.bytes)} · <a href={lastExport.url}>Download again</a> (link valid for 10 minutes)
          </p>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Settings */}
        <aside className="space-y-5 lg:col-span-4" aria-label="Catalogue settings">
          <section className="space-y-4 rounded-md border border-ink-200 bg-surface p-5">
            <h2 className="text-heading-sm font-semibold text-ink-900">Layout</h2>
            <Segmented label="Page layout" value={c.layout} disabled={!canEdit} onChange={(v) => actions.updateSettings({ layout: v })}
              options={[{ value: "grid", label: "Grid" }, { value: "editorial", label: "Editorial" }]} />
            <p className="-mt-2 text-caption text-ink-500">
              {c.layout === "grid" ? `${c.orientation === "portrait" ? 4 : 6} products per page; long text is shortened.` : "One product per page with the full description."}
            </p>
            <Segmented label="A4 orientation" value={c.orientation} disabled={!canEdit} onChange={(v) => actions.updateSettings({ orientation: v })}
              options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
          </section>

          <section className="space-y-4 rounded-md border border-ink-200 bg-surface p-5">
            <h2 className="text-heading-sm font-semibold text-ink-900">Pages</h2>
            <Toggle id="inc-cover" label="Cover page" checked={c.includeCover} disabled={!canEdit} onChange={(v) => actions.updateSettings({ includeCover: v })} />
            {c.includeCover && (
              <div className="space-y-3 pl-7">
                <div>
                  <label htmlFor="cover-title" className="text-caption font-medium text-ink-700">Cover title</label>
                  <Input id="cover-title" placeholder={c.name} value={c.coverTitle} maxLength={CATALOGUE_LIMITS.coverTitleMax} disabled={!canEdit}
                    onChange={(e) => actions.updateSettings({ coverTitle: e.target.value })} className="mt-1 h-10" />
                </div>
                <div>
                  <label htmlFor="cover-sub" className="text-caption font-medium text-ink-700">Cover subtitle</label>
                  <Input id="cover-sub" value={c.coverSubtitle} maxLength={CATALOGUE_LIMITS.coverSubtitleMax} disabled={!canEdit}
                    onChange={(e) => actions.updateSettings({ coverSubtitle: e.target.value })} className="mt-1 h-10" />
                </div>
                <p className="text-caption text-ink-500">The first product with an image is used on the cover.</p>
              </div>
            )}
            <Toggle id="inc-contact" label="Contact page" hint="Uses the details from Business details." checked={c.includeContactPage} disabled={!canEdit}
              onChange={(v) => actions.updateSettings({ includeContactPage: v })} />
            <Toggle id="show-prices" label="Show prices" hint="Only prices you’ve entered are shown." checked={c.showPrices} disabled={!canEdit}
              onChange={(v) => actions.updateSettings({ showPrices: v })} />
            {c.showPrices && (
              <div className="pl-7">
                <label htmlFor="price-note" className="text-caption font-medium text-ink-700">Text for products without a price (optional)</label>
                <Input id="price-note" placeholder="e.g. Price on request" value={c.priceNote} maxLength={CATALOGUE_LIMITS.priceNoteMax} disabled={!canEdit}
                  onChange={(e) => actions.updateSettings({ priceNote: e.target.value })} className="mt-1 h-10" />
              </div>
            )}
            <Link href="/app/settings/business" className="block text-body-sm text-gold-700 underline underline-offset-4">Edit business name, logo and contact details</Link>
          </section>

          {c.warnings.length > 0 && (
            <Alert tone="warning" title="Before you export">
              <ul className="list-disc space-y-1 pl-4">{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Alert>
          )}
        </aside>

        {/* Products */}
        <section className="space-y-4 lg:col-span-8" aria-labelledby="products-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="products-title" className="text-heading-md font-semibold text-ink-900">
              Products <span className="font-normal text-ink-500 tabular">({c.items.length})</span>
            </h2>
            {canEdit && <AddImagesDialog alreadyAdded={alreadyAdded} onAdd={actions.addImages} disabled={c.items.length >= CATALOGUE_LIMITS.maxItems} />}
          </div>

          {c.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-300 bg-surface-sunken p-10 text-center">
              <p className="font-serif text-display-sm text-ink-900">No products yet</p>
              <p className="mt-2 text-body-sm text-ink-600">Add images you’ve approved in the Studio, then fill in the details you want to show.</p>
            </div>
          ) : (
            <ol className="space-y-3" aria-label="Products in catalogue order">
              {c.items.map((item, index) => (
                <li
                  key={item.id}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) void actions.moveItem(dragIndex, index);
                    setDragIndex(null);
                  }}
                >
                  <ProductEditor
                    item={item}
                    index={index}
                    total={c.items.length}
                    showPrices={c.showPrices}
                    downloadHref={item.imageUrl ? catalogueApi.itemDownloadUrl(c.id, item.id) : null}
                    onChange={(patch) => actions.updateItem(item.id, patch)}
                    onMove={(to) => void actions.moveItem(index, to)}
                    onRemove={() => void actions.removeItem(item.id)}
                    dragging={dragIndex === index}
                    dragHandleProps={{
                      draggable: canEdit,
                      onDragStart: (e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = "move";
                      },
                      onDragEnd: () => setDragIndex(null),
                    }}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Preview */}
      {previewOpen && (
        <section aria-labelledby="preview-title" className="rounded-md border border-ink-200 bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 p-3">
            <h2 id="preview-title" className="text-heading-sm font-semibold text-ink-900">Preview</h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void actions.refreshPreview()}>
                <RefreshCw aria-hidden /> Refresh
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={catalogueApi.previewUrl(c.id, previewKey)} target="_blank" rel="noopener">Open in new tab</a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>Close</Button>
            </div>
          </div>
          <p className="px-3 pt-2 text-caption text-ink-500">Screen-quality images; the exported PDF uses full print resolution.</p>
          <iframe key={previewKey} title="Catalogue preview" src={catalogueApi.previewUrl(c.id, previewKey)} className="h-[80dvh] w-full" />
        </section>
      )}
    </div>
  );
}

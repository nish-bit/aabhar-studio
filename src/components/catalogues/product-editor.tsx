"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Download, GripVertical, ImageOff, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CATALOGUE_LIMITS,
  formatPricePaise,
  parseRupeesToPaise,
  type CatalogueItemView,
  type CatalogueSpec,
  type ItemPatch,
} from "@/lib/catalogue";
import { cn } from "@/lib/utils";

export interface ProductEditorProps {
  item: CatalogueItemView;
  index: number;
  total: number;
  showPrices: boolean;
  downloadHref: string | null;
  onChange: (patch: ItemPatch) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  dragging?: boolean;
}

/** One product: image, the shop's own details, specs, and order controls. */
export function ProductEditor({ item, index, total, showPrices, downloadHref, onChange, onMove, onRemove, dragHandleProps, dragging }: ProductEditorProps) {
  const id = (f: string) => `item-${item.id}-${f}`;
  const [priceText, setPriceText] = React.useState(item.pricePaise === null ? "" : String(item.pricePaise / 100));
  const [priceError, setPriceError] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const commitPrice = (text: string) => {
    setPriceText(text);
    const paise = parseRupeesToPaise(text);
    if (paise === null) {
      setPriceError(null);
      onChange({ pricePaise: null });
    } else if (Number.isNaN(paise) || paise > CATALOGUE_LIMITS.maxPricePaise) {
      setPriceError("Enter an amount like 12500 or 1,23,450.50");
    } else {
      setPriceError(null);
      onChange({ pricePaise: paise });
    }
  };

  const setSpecs = (specs: CatalogueSpec[]) => onChange({ specs });

  return (
    <div className={cn("rounded-md border border-ink-200 bg-surface p-4 transition-shadow", dragging && "opacity-60 shadow-md")}>
      <div className="flex gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            aria-label={`Drag to reorder product ${index + 1}`}
            className="hidden cursor-grab rounded-xs p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900 active:cursor-grabbing md:block"
            {...dragHandleProps}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <span className="text-caption font-medium text-ink-500 tabular">{index + 1}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`Move product ${index + 1} up`}>
            <ArrowUp aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(index + 1)} disabled={index === total - 1} aria-label={`Move product ${index + 1} down`}>
            <ArrowDown aria-hidden />
          </Button>
        </div>

        <div className="w-24 shrink-0 sm:w-32">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name || `Product ${index + 1}`} className="aspect-square w-full rounded-xs border border-ink-200 bg-surface-raised object-contain" />
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xs border border-dashed border-ink-300 bg-surface-sunken text-center text-caption text-ink-500">
              <ImageOff className="size-5" aria-hidden />
              Image unavailable
            </div>
          )}
          {downloadHref && (
            <a href={downloadHref} className="mt-1.5 inline-flex items-center gap-1 text-caption text-gold-700 underline-offset-2 hover:underline">
              <Download className="size-3" aria-hidden /> Image
            </a>
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={id("name")} className="text-caption font-medium text-ink-700">Product name</label>
            <Input id={id("name")} value={item.name} maxLength={CATALOGUE_LIMITS.nameMax} onChange={(e) => onChange({ name: e.target.value })} className="mt-1 h-10" />
          </div>
          <div>
            <label htmlFor={id("sku")} className="text-caption font-medium text-ink-700">SKU / design code</label>
            <Input id={id("sku")} value={item.sku} maxLength={CATALOGUE_LIMITS.skuMax} onChange={(e) => onChange({ sku: e.target.value })} className="mt-1 h-10" />
          </div>
          <div>
            <label htmlFor={id("price")} className="text-caption font-medium text-ink-700">
              Price (₹) {!showPrices && <span className="font-normal text-ink-500">· hidden in this catalogue</span>}
            </label>
            <Input
              id={id("price")}
              inputMode="decimal"
              value={priceText}
              onChange={(e) => commitPrice(e.target.value)}
              aria-invalid={priceError ? true : undefined}
              aria-describedby={priceError ? id("price-error") : id("price-hint")}
              className="mt-1 h-10 tabular"
            />
            {priceError ? (
              <p id={id("price-error")} className="mt-1 text-caption text-error-fg">{priceError}</p>
            ) : (
              <p id={id("price-hint")} className="mt-1 text-caption text-ink-500">
                {item.pricePaise !== null ? `Shows as ${formatPricePaise(item.pricePaise)}` : "Leave blank if you don't want a price."}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id("desc")} className="text-caption font-medium text-ink-700">Description</label>
            <Textarea
              id={id("desc")}
              value={item.description}
              maxLength={CATALOGUE_LIMITS.descriptionMax}
              onChange={(e) => onChange({ description: e.target.value })}
              rows={3}
              className="mt-1 min-h-20"
            />
            <p className="mt-1 text-right text-caption text-ink-500 tabular">
              {item.description.length}/{CATALOGUE_LIMITS.descriptionMax} · grid pages show the first few lines
            </p>
          </div>
          <SpecsEditor itemId={item.id} specs={item.specs} onChange={setSpecs} />
        </div>
      </div>

      <div className="mt-3 flex justify-end border-t border-ink-200 pt-3">
        {confirmRemove ? (
          <div className="flex items-center gap-2" role="group" aria-label="Confirm removal">
            <span className="text-body-sm text-ink-700">Remove this product from the catalogue?</span>
            <Button size="sm" variant="destructive" onClick={onRemove}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function SpecsEditor({ specs, onChange }: { itemId: string; specs: CatalogueSpec[]; onChange: (s: CatalogueSpec[]) => void }) {
  const [rows, setRows] = React.useState<CatalogueSpec[]>(specs);
  const update = (next: CatalogueSpec[]) => {
    setRows(next);
    onChange(next);
  };
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-caption font-medium text-ink-700">Specifications</legend>
      <p className="text-caption text-ink-500">Only add details you can stand behind, e.g. weight, purity, size or stone details from your records.</p>
      {rows.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {rows.map((row, i) => (
            <li key={i} className="flex gap-2">
              <Input
                aria-label={`Specification ${i + 1} name`}
                placeholder="Name"
                value={row.label}
                maxLength={CATALOGUE_LIMITS.specLabelMax}
                onChange={(e) => update(rows.map((r, k) => (k === i ? { ...r, label: e.target.value } : r)))}
                className="h-9 w-2/5"
              />
              <Input
                aria-label={`Specification ${i + 1} value`}
                placeholder="Value"
                value={row.value}
                maxLength={CATALOGUE_LIMITS.specValueMax}
                onChange={(e) => update(rows.map((r, k) => (k === i ? { ...r, value: e.target.value } : r)))}
                className="h-9 flex-1"
              />
              <Button variant="ghost" size="icon-sm" onClick={() => update(rows.filter((_, k) => k !== i))} aria-label={`Remove specification ${i + 1}`}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rows.length < CATALOGUE_LIMITS.specsMax && (
        <Button
          variant="link"
          size="sm"
          className="mt-2"
          onClick={() => setRows([...rows, { label: "", value: "" }])}
        >
          <Plus aria-hidden /> Add specification
        </Button>
      )}
    </fieldset>
  );
}

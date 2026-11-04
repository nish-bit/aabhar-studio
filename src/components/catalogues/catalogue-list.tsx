"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { catalogueApi } from "@/features/catalogues/api-client";
import { CATALOGUE_LIMITS, type CatalogueSummary } from "@/lib/catalogue";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

type DialogState =
  | { kind: "create" }
  | { kind: "rename"; catalogue: CatalogueSummary }
  | { kind: "delete"; catalogue: CatalogueSummary }
  | null;

export function CatalogueList({ initial, initialDeleted, canEdit }: { initial: CatalogueSummary[]; initialDeleted: CatalogueSummary[]; canEdit: boolean }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [deleted, setDeleted] = React.useState(initialDeleted);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);

  const refresh = async () => {
    const [a, d] = await Promise.all([catalogueApi.list(), catalogueApi.list(true)]);
    setItems(a);
    setDeleted(d);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setName("");
    setDialog({ kind: "create" });
  };

  const submitName = () =>
    run(async () => {
      if (dialog?.kind === "create") {
        const c = await catalogueApi.create(name.trim());
        router.push(`/app/catalogues/${c.id}`);
      } else if (dialog?.kind === "rename") {
        const full = await catalogueApi.get(dialog.catalogue.id);
        await catalogueApi.saveSettings(full.id, full.version, { name: name.trim() });
        await refresh();
        setDialog(null);
      }
    });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-serif text-display-md font-medium text-ink-900">Catalogues</h1>
          <p className="mt-2 text-body text-ink-600">Build print-ready PDFs from your approved images. Drafts save automatically.</p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus aria-hidden /> New catalogue
          </Button>
        )}
      </div>

      {error && <Alert tone="error" live="assertive">{error}</Alert>}

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-300 bg-surface-sunken p-12 text-center">
          <BookOpen className="mx-auto size-8 text-ink-400" strokeWidth={1.5} aria-hidden />
          <p className="mt-4 font-serif text-display-sm text-ink-900">No catalogues yet</p>
          <p className="mt-2 text-body-sm text-ink-600">Create one, add approved images, and export a PDF to share or print.</p>
          {canEdit && <Button className="mt-6" onClick={openCreate}><Plus aria-hidden /> New catalogue</Button>}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <li key={c.id} className="group relative overflow-hidden rounded-md border border-ink-200 bg-surface transition-shadow hover:shadow-sm">
              <Link href={`/app/catalogues/${c.id}`} className="block">
                <div className="aspect-[4/3] bg-surface-sunken">
                  {c.coverThumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.coverThumbUrl} alt="" className="size-full object-contain" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-caption text-ink-500">No products yet</div>
                  )}
                </div>
                <div className="p-4 pr-12">
                  <p className="truncate text-heading-sm font-semibold text-ink-900">{c.name}</p>
                  <p className="mt-1 text-caption text-ink-600">
                    {c.itemCount} {c.itemCount === 1 ? "product" : "products"} · {c.layout === "grid" ? "Grid" : "Editorial"} · A4 {c.orientation}
                  </p>
                  <p className="mt-0.5 text-caption text-ink-500">Edited {dateFmt.format(new Date(c.updatedAt))}</p>
                </div>
              </Link>
              {canEdit && (
                <div className="absolute bottom-3 right-3">
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`} aria-expanded={menuFor === c.id} onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                  {menuFor === c.id && (
                    <div role="menu" className="absolute bottom-10 right-0 z-10 w-44 rounded-md border border-ink-200 bg-surface p-1 shadow-md">
                      <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-xs px-3 py-2 text-body-sm hover:bg-ink-100"
                        onClick={() => { setMenuFor(null); setName(c.name); setDialog({ kind: "rename", catalogue: c }); }}>
                        <Pencil className="size-4" aria-hidden /> Rename
                      </button>
                      <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-xs px-3 py-2 text-body-sm hover:bg-ink-100"
                        onClick={() => { setMenuFor(null); void run(async () => { await catalogueApi.duplicate(c.id); await refresh(); }); }}>
                        <Copy className="size-4" aria-hidden /> Duplicate
                      </button>
                      <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-xs px-3 py-2 text-body-sm text-error-fg hover:bg-error-bg"
                        onClick={() => { setMenuFor(null); setDialog({ kind: "delete", catalogue: c }); }}>
                        <Trash2 className="size-4" aria-hidden /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleted.length > 0 && (
        <section aria-labelledby="deleted-title">
          <h2 id="deleted-title" className="text-heading-sm font-semibold text-ink-900">Recently deleted</h2>
          <ul className="mt-3 divide-y divide-ink-200 rounded-md border border-ink-200 bg-surface">
            {deleted.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-ink-900">{c.name}</p>
                  <p className="text-caption text-ink-500">{c.itemCount} products · deleted {c.deletedAt ? dateFmt.format(new Date(c.deletedAt)) : ""}</p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => { await catalogueApi.restore(c.id); await refresh(); })}>
                    <RotateCcw aria-hidden /> Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={dialog?.kind === "create" || dialog?.kind === "rename"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); void submitName(); }}>
            <DialogHeader>
              <DialogTitle>{dialog?.kind === "rename" ? "Rename catalogue" : "New catalogue"}</DialogTitle>
              <DialogDescription>{dialog?.kind === "rename" ? "The new name is saved straight away." : "You can change everything later."}</DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              <label htmlFor="catalogue-name" className="text-body-sm font-medium text-ink-900">Name</label>
              <Input id="catalogue-name" autoFocus required maxLength={CATALOGUE_LIMITS.nameMax} value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder="e.g. Dhanteras 2026 — Retail" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" loading={busy} loadingLabel="Saving…" disabled={!name.trim()}>{dialog?.kind === "rename" ? "Rename" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{dialog?.kind === "delete" ? dialog.catalogue.name : ""}”?</DialogTitle>
            <DialogDescription>It moves to Recently deleted, where you can restore it. Your approved images aren’t affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" loading={busy} loadingLabel="Deleting…" onClick={() => dialog?.kind === "delete" && void run(async () => { await catalogueApi.remove(dialog.catalogue.id); await refresh(); setDialog(null); })}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

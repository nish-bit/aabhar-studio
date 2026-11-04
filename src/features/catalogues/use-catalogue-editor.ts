"use client";

import * as React from "react";

import type { CatalogueItemView, CatalogueSettingsPatch, CatalogueView, ItemPatch } from "@/lib/catalogue";

import { ApiError, catalogueApi } from "./api-client";

export type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

const SETTINGS_DEBOUNCE = 600;
const ITEM_DEBOUNCE = 700;

/**
 * Draft editing with autosave. Every change is applied locally at once and
 * saved shortly after; settings saves carry the version they were based on,
 * so a stale tab gets a conflict instead of overwriting newer work.
 */
export function useCatalogueEditor(initial: CatalogueView) {
  const [catalogue, setCatalogue] = React.useState(initial);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [error, setError] = React.useState<string | null>(null);
  const [previewKey, setPreviewKey] = React.useState(0);

  const versionRef = React.useRef(initial.version);
  const pendingSettings = React.useRef<CatalogueSettingsPatch>({});
  const settingsTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingItems = React.useRef(new Map<string, ItemPatch>());
  const itemTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlight = React.useRef(new Set<Promise<unknown>>());

  const track = React.useCallback(<T,>(p: Promise<T>) => {
    inFlight.current.add(p);
    void p.finally(() => {
      inFlight.current.delete(p);
      if (
        inFlight.current.size === 0 &&
        pendingItems.current.size === 0 &&
        Object.keys(pendingSettings.current).length === 0
      ) {
        setSaveState((s) => (s === "saving" ? "saved" : s));
      }
    });
    return p;
  }, []);

  const fail = React.useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      setSaveState("conflict");
      setError(err.message);
    } else {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }, []);

  /* ------------------------------------------------------------ settings */
  const saveSettingsNow = React.useCallback(async () => {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = null;
    const patch = pendingSettings.current;
    if (Object.keys(patch).length === 0) return;
    pendingSettings.current = {};
    setSaveState("saving");
    try {
      const res = await track(catalogueApi.saveSettings(catalogue.id, versionRef.current, patch));
      versionRef.current = res.version;
      setCatalogue((c) => ({ ...c, version: res.version, updatedAt: res.updatedAt }));
    } catch (err) {
      fail(err);
    }
  }, [catalogue.id, track, fail]);

  const updateSettings = React.useCallback(
    (patch: CatalogueSettingsPatch) => {
      setCatalogue((c) => ({ ...c, ...patch }));
      pendingSettings.current = { ...pendingSettings.current, ...patch };
      setSaveState("unsaved");
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => void saveSettingsNow(), SETTINGS_DEBOUNCE);
    },
    [saveSettingsNow],
  );

  /* --------------------------------------------------------------- items */
  const saveItemNow = React.useCallback(
    async (itemId: string) => {
      const t = itemTimers.current.get(itemId);
      if (t) clearTimeout(t);
      itemTimers.current.delete(itemId);
      const patch = pendingItems.current.get(itemId);
      if (!patch) return;
      pendingItems.current.delete(itemId);
      setSaveState("saving");
      try {
        await track(catalogueApi.saveItem(catalogue.id, itemId, patch));
      } catch (err) {
        fail(err);
      }
    },
    [catalogue.id, track, fail],
  );

  const updateItem = React.useCallback(
    (itemId: string, patch: ItemPatch) => {
      setCatalogue((c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
      pendingItems.current.set(itemId, { ...(pendingItems.current.get(itemId) ?? {}), ...patch });
      setSaveState("unsaved");
      const t = itemTimers.current.get(itemId);
      if (t) clearTimeout(t);
      itemTimers.current.set(itemId, setTimeout(() => void saveItemNow(itemId), ITEM_DEBOUNCE));
    },
    [saveItemNow],
  );

  /** Save everything pending now (before preview, export or leaving). */
  const flush = React.useCallback(async () => {
    await saveSettingsNow();
    await Promise.all([...pendingItems.current.keys()].map((id) => saveItemNow(id)));
    await Promise.allSettled([...inFlight.current]);
  }, [saveSettingsNow, saveItemNow]);

  // Warn before closing the tab with unsaved changes; save when hidden.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === "unsaved" || saveState === "saving") e.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [saveState, flush]);

  /* ------------------------------------------------- structure changes */
  /** Take the server's structure but keep any local edits that haven't been saved yet. */
  const replaceFromServer = React.useCallback((view: CatalogueView) => {
    versionRef.current = view.version;
    const pendingKeys = Object.keys(pendingSettings.current) as (keyof CatalogueView)[];
    setCatalogue((c) => ({
      ...view,
      items: view.items.map((i) => {
        const pending = pendingItems.current.get(i.id);
        return pending ? { ...i, ...pending } : i;
      }),
      ...Object.fromEntries(pendingKeys.map((k) => [k, c[k]])),
    }));
  }, []);

  const addImages = React.useCallback(
    async (ids: string[]) => {
      await flush();
      const res = await catalogueApi.addItems(catalogue.id, ids);
      replaceFromServer(res.catalogue);
      return res;
    },
    [catalogue.id, flush, replaceFromServer],
  );

  const removeItem = React.useCallback(
    async (itemId: string) => {
      pendingItems.current.delete(itemId);
      const before = catalogue.items;
      setCatalogue((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, position: idx })) }));
      try {
        await track(catalogueApi.removeItem(catalogue.id, itemId));
        replaceFromServer(await catalogueApi.get(catalogue.id));
      } catch (err) {
        setCatalogue((c) => ({ ...c, items: before }));
        fail(err);
      }
    },
    [catalogue.id, catalogue.items, track, fail, replaceFromServer],
  );

  const moveItem = React.useCallback(
    async (from: number, to: number) => {
      if (to < 0 || to >= catalogue.items.length || from === to) return;
      const next: CatalogueItemView[] = [...catalogue.items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      const before = catalogue.items;
      setCatalogue((c) => ({ ...c, items: next.map((i, idx) => ({ ...i, position: idx })) }));
      setSaveState("saving");
      try {
        await track(catalogueApi.reorder(catalogue.id, next.map((i) => i.id)));
      } catch (err) {
        setCatalogue((c) => ({ ...c, items: before }));
        fail(err);
      }
    },
    [catalogue.id, catalogue.items, track, fail],
  );

  const reload = React.useCallback(async () => {
    pendingSettings.current = {};
    pendingItems.current.clear();
    const view = await catalogueApi.get(catalogue.id);
    versionRef.current = view.version;
    setCatalogue(view);
    setSaveState("saved");
    setError(null);
  }, [catalogue.id]);

  const refreshPreview = React.useCallback(async () => {
    await flush();
    // Warnings may have changed (e.g. images added); refetch them.
    try {
      const view = await catalogueApi.get(catalogue.id);
      setCatalogue((c) => ({ ...c, warnings: view.warnings }));
    } catch {
      // non-critical
    }
    setPreviewKey((k) => k + 1);
  }, [catalogue.id, flush]);

  return {
    catalogue,
    saveState,
    error,
    previewKey,
    actions: { updateSettings, updateItem, addImages, removeItem, moveItem, flush, reload, refreshPreview, dismissError: () => setError(null) },
  };
}

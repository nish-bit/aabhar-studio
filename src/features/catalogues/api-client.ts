"use client";

import type {
  ApprovedImageView,
  BusinessProfilePatch,
  BusinessProfileView,
  CatalogueExportView,
  CatalogueSettingsPatch,
  CatalogueSummary,
  CatalogueView,
  ItemPatch,
} from "@/lib/catalogue";
import { ApiError } from "@/features/studio/api-client";

export { ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_error", "You appear to be offline. Your changes will be saved when you reconnect.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(
      (body?.error?.code as never) ?? "internal_error",
      body?.error?.message ?? "Something went wrong. Please try again.",
      res.status,
    );
  }
  return (await res.json()) as T;
}

const body = (b: unknown) => JSON.stringify(b);

export const catalogueApi = {
  list: (deleted = false) => call<CatalogueSummary[]>(`/api/catalogues${deleted ? "?deleted=1" : ""}`),
  create: (name: string) => call<CatalogueView>("/api/catalogues", { method: "POST", body: body({ name }) }),
  get: (id: string) => call<CatalogueView>(`/api/catalogues/${id}`),
  saveSettings: (id: string, version: number, patch: CatalogueSettingsPatch) =>
    call<{ version: number; updatedAt: string }>(`/api/catalogues/${id}`, { method: "PATCH", body: body({ version, ...patch }) }),
  remove: (id: string) => call<{ ok: true }>(`/api/catalogues/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => call<CatalogueView>(`/api/catalogues/${id}/duplicate`, { method: "POST" }),
  restore: (id: string) => call<CatalogueView>(`/api/catalogues/${id}/restore`, { method: "POST" }),
  addItems: (id: string, generatedImageIds: string[]) =>
    call<{ added: number; rejected: number; catalogue: CatalogueView }>(`/api/catalogues/${id}/items`, {
      method: "POST",
      body: body({ generatedImageIds }),
    }),
  saveItem: (id: string, itemId: string, patch: ItemPatch) =>
    call<{ ok: true }>(`/api/catalogues/${id}/items/${itemId}`, { method: "PATCH", body: body(patch) }),
  removeItem: (id: string, itemId: string) => call<{ ok: true }>(`/api/catalogues/${id}/items/${itemId}`, { method: "DELETE" }),
  reorder: (id: string, itemIds: string[]) =>
    call<{ ok: true }>(`/api/catalogues/${id}/items/order`, { method: "PUT", body: body({ itemIds }) }),
  exportFile: (id: string, kind: "pdf" | "images_zip") =>
    call<CatalogueExportView>(`/api/catalogues/${id}/export`, { method: "POST", body: body({ kind }) }),
  previewUrl: (id: string, version: number) => `/api/catalogues/${id}/preview?v=${version}`,
  itemDownloadUrl: (id: string, itemId: string) => `/api/catalogues/${id}/items/${itemId}/download`,
  approvedImages: (before?: string) =>
    call<ApprovedImageView[]>(`/api/approved-images${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  businessProfile: () => call<BusinessProfileView>("/api/business-profile"),
  saveBusinessProfile: (patch: BusinessProfilePatch) =>
    call<BusinessProfileView>("/api/business-profile", { method: "PATCH", body: body(patch) }),
  signLogo: (mimeType: string, sizeBytes: number) =>
    call<{ bucket: string; path: string; token: string }>("/api/business-profile/logo/sign", {
      method: "POST",
      body: body({ mimeType, sizeBytes }),
    }),
  completeLogo: (path: string) =>
    call<BusinessProfileView>("/api/business-profile/logo/complete", { method: "POST", body: body({ path }) }),
  removeLogo: () => call<BusinessProfileView>("/api/business-profile/logo", { method: "DELETE" }),
};

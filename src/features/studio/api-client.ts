"use client";

import type {
  ApiErrorBody,
  ApiErrorCode,
  CreateGenerationRequest,
  CreateGenerationResponse,
  CreditsView,
  GenerationView,
  ReviewRequest,
  SignUploadRequest,
  SignUploadResponse,
  SourceImageView,
} from "@/lib/api-types";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | "network_error",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_error", "You appear to be offline. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // ignore
    }
    throw new ApiError(
      body?.error.code ?? "internal_error",
      body?.error.message ?? "Something went wrong. Please try again.",
      res.status,
    );
  }
  return (await res.json()) as T;
}

export const studioApi = {
  signUpload: (body: SignUploadRequest) =>
    request<SignUploadResponse>("/api/uploads/sign", { method: "POST", body: JSON.stringify(body) }),
  completeUpload: (id: string) => request<SourceImageView>(`/api/uploads/${id}/complete`, { method: "POST" }),
  createGeneration: (body: CreateGenerationRequest, idempotencyKey: string) =>
    request<CreateGenerationResponse>("/api/generations", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  getGeneration: (id: string) => request<GenerationView>(`/api/generations/${id}`),
  review: (id: string, body: ReviewRequest) =>
    request<GenerationView>(`/api/generations/${id}/review`, { method: "POST", body: JSON.stringify(body) }),
  credits: () => request<CreditsView>("/api/credits"),
  downloadHref: (id: string) => `/api/generations/${id}/download`,
};

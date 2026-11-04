import { z } from "zod";

import { ProviderError } from "./errors";
import { estimateCostUsdMicros } from "./pricing";
import type { EditImageRequest, EditImageResult, ImageEditProvider, TokenUsage } from "./types";

/**
 * OpenAI Images API — edits endpoint (POST /v1/images/edits).
 * Docs: https://developers.openai.com/api/reference/python/resources/images/methods/edit
 *
 * - Synchronous: the response carries the edited image as base64 (`b64_json`);
 *   GPT image models do not return URLs.
 * - `input_fidelity` is only accepted by gpt-image-1 / gpt-image-1.5 and must be
 *   omitted for the gpt-image-2 family, per the reference.
 * - `usage` is returned when available; cost is estimated from it.
 */

export interface OpenAIImageProviderOptions {
  apiKey: string;
  model: string;
  quality: "low" | "medium" | "high" | "auto";
  baseUrl?: string;
  timeoutMs: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MODELS_WITH_INPUT_FIDELITY = new Set(["gpt-image-1", "gpt-image-1.5"]);

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({ text_tokens: z.number().int().optional(), image_tokens: z.number().int().optional() })
      .optional(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ text_tokens: z.number().int().optional(), image_tokens: z.number().int().optional() })
      .optional(),
    total_tokens: z.number().int().nonnegative(),
  })
  .optional()
  .nullable();

const responseSchema = z.object({
  created: z.number(),
  data: z
    .array(z.object({ b64_json: z.string().min(1).optional().nullable(), url: z.string().optional().nullable() }))
    .min(1),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  usage: usageSchema,
});

const errorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional().nullable(),
    code: z.string().optional().nullable(),
  }),
});

function parseRetryAfter(headers: Headers): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Number(ms);
  const s = headers.get("retry-after");
  if (s && Number.isFinite(Number(s))) return Number(s) * 1000;
  return null;
}

const mimeFor = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

export class OpenAIImageProvider implements ImageEditProvider {
  readonly id = "openai";
  readonly model: string;
  private readonly opts: Required<Omit<OpenAIImageProviderOptions, "fetchImpl" | "now">> & {
    fetchImpl: typeof fetch;
    now: () => number;
  };

  constructor(options: OpenAIImageProviderOptions) {
    this.model = options.model;
    this.opts = {
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: globalThis.fetch.bind(globalThis),
      now: Date.now,
      ...options,
    };
  }

  async editImage(request: EditImageRequest): Promise<EditImageResult> {
    const started = this.opts.now();

    const form = new FormData();
    form.append("model", this.model);
    form.append("prompt", request.prompt);
    form.append(
      "image",
      new Blob([request.image.bytes as BlobPart], { type: request.image.mimeType }),
      request.image.fileName,
    );
    form.append("n", "1");
    form.append("size", request.size);
    form.append("quality", this.opts.quality);
    form.append("output_format", "png");
    form.append("background", "opaque");
    form.append("safety_identifier", request.safetyIdentifier);
    if (MODELS_WITH_INPUT_FIDELITY.has(this.model)) form.append("input_fidelity", "high");

    // Per-attempt timeout, combined with any caller-provided abort signal.
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.opts.fetchImpl(`${this.opts.baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal,
      });
    } catch (err) {
      if (timeout.aborted) {
        throw new ProviderError("timeout", `Image edit timed out after ${this.opts.timeoutMs} ms`, { cause: err });
      }
      if (request.signal?.aborted) {
        throw new ProviderError("fatal", "Image edit was cancelled", { cause: err });
      }
      throw new ProviderError("retryable", "Network error calling image provider", { cause: err });
    }

    const requestId = response.headers.get("x-request-id");

    if (!response.ok) {
      throw await this.toProviderError(response, requestId);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new ProviderError("fatal", "Image provider returned invalid JSON", {
        status: response.status,
        providerRequestId: requestId,
        cause: err,
      });
    }

    const parsed = responseSchema.safeParse(json);
    const b64 = parsed.success ? parsed.data.data[0]?.b64_json : null;
    if (!parsed.success || !b64) {
      throw new ProviderError("fatal", "Image provider response had no image data", {
        status: response.status,
        providerRequestId: requestId,
      });
    }

    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    if (bytes.byteLength < 100) {
      throw new ProviderError("fatal", "Image provider returned an empty image", { providerRequestId: requestId });
    }

    const u = parsed.data.usage;
    const usage: TokenUsage | null = u
      ? {
          inputTokens: u.input_tokens,
          inputTextTokens: u.input_tokens_details?.text_tokens ?? null,
          inputImageTokens: u.input_tokens_details?.image_tokens ?? null,
          outputTokens: u.output_tokens,
          outputImageTokens: u.output_tokens_details?.image_tokens ?? null,
          totalTokens: u.total_tokens,
        }
      : null;

    return {
      image: bytes,
      mimeType: mimeFor[parsed.data.output_format ?? "png"],
      model: this.model,
      providerRequestId: requestId,
      usage,
      costUsdMicros: estimateCostUsdMicros(this.model, usage),
      latencyMs: this.opts.now() - started,
    };
  }

  private async toProviderError(response: Response, requestId: string | null): Promise<ProviderError> {
    let code: string | null = null;
    let message = `Image provider returned HTTP ${response.status}`;
    try {
      const body = errorSchema.safeParse(await response.json());
      if (body.success) {
        code = body.data.error.code ?? body.data.error.type ?? null;
        if (body.data.error.message) message = body.data.error.message;
      }
    } catch {
      // non-JSON error body; keep the generic message
    }

    const base = { status: response.status, providerCode: code, providerRequestId: requestId };
    const status = response.status;

    if (status === 429) {
      if (code === "insufficient_quota" || code === "billing_hard_limit_reached") {
        return new ProviderError("quota_exceeded", message, base);
      }
      return new ProviderError("rate_limited", message, { ...base, retryAfterMs: parseRetryAfter(response.headers) });
    }
    if (status === 401 || status === 403) return new ProviderError("auth", message, base);
    if (code === "moderation_blocked" || code === "content_policy_violation") {
      return new ProviderError("content_blocked", message, base);
    }
    if (status === 400 || status === 413 || status === 415 || status === 422) {
      return new ProviderError("invalid_input", message, base);
    }
    if (status === 408 || status >= 500) return new ProviderError("retryable", message, base);
    return new ProviderError("fatal", message, base);
  }
}

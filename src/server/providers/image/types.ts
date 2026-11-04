/**
 * Provider-neutral contract for image editing.
 * Business logic depends only on these types; each vendor gets an adapter.
 */

export interface ImageInput {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  fileName: string;
}

export type OutputSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface EditImageRequest {
  /** The shop's product photo. Sent as the reference image to edit. */
  image: ImageInput;
  /** Full prompt, built server-side from the preset and sanitised user notes. */
  prompt: string;
  size: OutputSize;
  /** Stable, hashed end-user identifier for provider abuse monitoring. */
  safetyIdentifier: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  inputTextTokens: number | null;
  inputImageTokens: number | null;
  outputTokens: number;
  outputImageTokens: number | null;
  totalTokens: number;
}

export interface EditImageResult {
  image: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  /** Provider's model identifier actually used. */
  model: string;
  /** Provider request id, kept for support tickets. */
  providerRequestId: string | null;
  usage: TokenUsage | null;
  /** Estimated cost in millionths of a US dollar; null if usage or pricing is unknown. */
  costUsdMicros: number | null;
  latencyMs: number;
}

export interface ImageEditProvider {
  readonly id: string;
  readonly model: string;
  editImage(request: EditImageRequest): Promise<EditImageResult>;
}

import "server-only";

import { openAIConfig } from "@/server/env";

import { OpenAIImageProvider } from "./openai";
import type { ImageEditProvider } from "./types";

/**
 * Returns the configured image-editing provider, or null when no provider
 * credentials are set (integration-ready state). Swap vendors here.
 */
export function getImageProvider(): ImageEditProvider | null {
  const cfg = openAIConfig();
  if (!cfg) return null;
  return new OpenAIImageProvider({
    apiKey: cfg.apiKey,
    model: cfg.model,
    quality: cfg.quality,
    baseUrl: cfg.baseUrl,
    timeoutMs: cfg.timeoutMs,
  });
}

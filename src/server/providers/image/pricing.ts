import type { TokenUsage } from "./types";

/**
 * USD per 1M tokens, from the OpenAI model pages
 * (developers.openai.com/api/docs/models/...), checked 2026-10-20.
 * Re-check before relying on these for invoicing — they are estimates for
 * internal cost tracking only.
 */
interface ModelPricing {
  textInput: number;
  imageInput: number;
  textOutput: number;
  imageOutput: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Page lists image output only; text output is priced at the image rate to stay conservative.
  "gpt-image-2.5-sunburst": { textInput: 5, imageInput: 8, textOutput: 30, imageOutput: 30 },
  "gpt-image-2.5-sunburst-2026-09-08": { textInput: 5, imageInput: 8, textOutput: 30, imageOutput: 30 },
  "gpt-image-1.5": { textInput: 5, imageInput: 8, textOutput: 10, imageOutput: 32 },
};

/** Estimated cost in micro-USD (1 USD = 1,000,000), or null if unknown. */
export function estimateCostUsdMicros(model: string, usage: TokenUsage | null): number | null {
  const p = PRICING[model];
  if (!p || !usage) return null;

  const inputImage = usage.inputImageTokens ?? 0;
  const inputText = usage.inputTextTokens ?? Math.max(0, usage.inputTokens - inputImage);
  const outputImage = usage.outputImageTokens ?? usage.outputTokens;
  const outputText = Math.max(0, usage.outputTokens - outputImage);

  // tokens × (USD per 1M tokens) = micro-USD
  const micros = inputText * p.textInput + inputImage * p.imageInput + outputText * p.textOutput + outputImage * p.imageOutput;
  return Math.round(micros);
}

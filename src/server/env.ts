import "server-only";

import { z } from "zod";

/**
 * Server environment, validated with Zod.
 *
 * Missing credentials don't crash the app: each integration reports
 * "not configured" so the UI can show a labelled, integration-ready state.
 * Malformed values (e.g. a bad URL) do throw, because that's a mistake.
 *
 * Nothing here is ever sent to the browser. Only NEXT_PUBLIC_SUPABASE_URL
 * and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are public by design.
 */

export const SUPPORTED_IMAGE_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
] as const;

export type ImageModel = (typeof SUPPORTED_IMAGE_MODELS)[number];

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(empty, z.url().optional()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(empty, z.string().min(20).optional()),
  SUPABASE_SECRET_KEY: z.preprocess(empty, z.string().min(20).optional()),
  /** Direct Postgres connection (Supabase transaction pooler). Used by the catalogue builder. */
  DATABASE_URL: z.preprocess(empty, z.string().regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres://").optional()),

  /** Connections per server instance (keep small on serverless with the transaction pooler). */
  DATABASE_POOL_MAX: z.preprocess(empty, z.coerce.number().int().min(1).max(20).default(5)),

  OPENAI_API_KEY: z.preprocess(empty, z.string().startsWith("sk-").optional()),
  OPENAI_IMAGE_MODEL: z.preprocess(empty, z.enum(SUPPORTED_IMAGE_MODELS).default("gpt-image-2.5-sunburst")),
  OPENAI_IMAGE_QUALITY: z.preprocess(empty, z.enum(["low", "medium", "high", "auto"]).default("high")),
  OPENAI_BASE_URL: z.preprocess(empty, z.url().default("https://api.openai.com/v1")),
  /** Per-attempt timeout for a provider call. */
  OPENAI_TIMEOUT_MS: z.preprocess(empty, z.coerce.number().int().min(10_000).max(280_000).default(140_000)),

  /** Max jobs a shop may have queued or processing at once. */
  GENERATION_MAX_ACTIVE_JOBS: z.preprocess(empty, z.coerce.number().int().min(1).max(50).default(3)),
  /** Max jobs a shop may create per rolling 24 hours (abuse cap on top of credits). */
  GENERATION_DAILY_LIMIT: z.preprocess(empty, z.coerce.number().int().min(1).max(10_000).default(200)),

  /**
   * Razorpay. Test keys start rzp_test_, live keys rzp_live_. Live keys are
   * refused unless BILLING_LIVE_APPROVED=true (set only after you approve
   * the live configuration — see docs/BILLING.md).
   */
  RAZORPAY_KEY_ID: z.preprocess(empty, z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, "RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_").optional()),
  RAZORPAY_KEY_SECRET: z.preprocess(empty, z.string().min(10).optional()),
  RAZORPAY_WEBHOOK_SECRET: z.preprocess(empty, z.string().min(12).optional()),
  BILLING_LIVE_APPROVED: z.preprocess(empty, z.enum(["true", "false"]).default("false")),

  /** Shared secret for the stale-job cron endpoint. */
  CRON_SECRET: z.preprocess(empty, z.string().min(16).optional()),

  /**
   * Marketing email (see src/server/marketing/campaigns.ts). Nothing is sent
   * unless MARKETING_EMAILS_ENABLED=true and a provider adapter exists.
   */
  MARKETING_EMAILS_ENABLED: z.preprocess(empty, z.enum(["true", "false"]).default("false")),
  MARKETING_EMAIL_PROVIDER: z.preprocess(empty, z.enum(["resend", "brevo", "mailchimp"]).optional()),
  /** Public site URL used in unsubscribe links, e.g. https://aabhar.studio */
  PUBLIC_SITE_URL: z.preprocess(empty, z.url().optional()),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** Returns null when Supabase isn't fully configured. */
export function supabaseConfig(): SupabaseConfig | null {
  const env = serverEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    return null;
  }
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: env.SUPABASE_SECRET_KEY,
  };
}

export interface OpenAIConfig {
  apiKey: string;
  model: ImageModel;
  quality: "low" | "medium" | "high" | "auto";
  baseUrl: string;
  timeoutMs: number;
}

/** Returns null when no provider key is set. */
export function openAIConfig(): OpenAIConfig | null {
  const env = serverEnv();
  if (!env.OPENAI_API_KEY) return null;
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_IMAGE_MODEL,
    quality: env.OPENAI_IMAGE_QUALITY,
    baseUrl: env.OPENAI_BASE_URL.replace(/\/$/, ""),
    timeoutMs: env.OPENAI_TIMEOUT_MS,
  };
}

/** What the UI may know about configuration — booleans only, never values. */
export interface IntegrationStatus {
  supabase: boolean;
  database: boolean;
  imageProvider: boolean;
  providerLabel: string | null;
}

export function integrationStatus(): IntegrationStatus {
  const provider = openAIConfig();
  return {
    supabase: supabaseConfig() !== null,
    database: Boolean(serverEnv().DATABASE_URL),
    imageProvider: provider !== null,
    providerLabel: provider ? `OpenAI ${provider.model}` : null,
  };
}

import "server-only";

import { ensureUserShop } from "@/server/auth/ensure-shop";
import { productionEntitlements } from "@/server/billing/deps";
import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { loadPresetSettings } from "@/server/presets/settings";
import { serverEnv } from "@/server/env";
import { getImageProvider } from "@/server/providers/image/registry";

import { DomainError } from "./domain-error";
import type { GenerationDeps } from "./service";
import { SupabaseGenerationRepository } from "./supabase-repository";
import { SupabaseObjectStorage } from "./supabase-storage";

/** Wires the production implementations. Throws if Supabase isn't configured. */
export function generationDeps(): GenerationDeps {
  const db = supabaseAdmin();
  if (!db) {
    throw new DomainError("storage_not_configured", "Storage and database aren't connected yet.", 503);
  }
  const env = serverEnv();
  return {
    repo: new SupabaseGenerationRepository(db),
    storage: new SupabaseObjectStorage(db),
    provider: getImageProvider(),
    limits: { maxActiveJobs: env.GENERATION_MAX_ACTIVE_JOBS, dailyLimit: env.GENERATION_DAILY_LIMIT },
    entitlements: productionEntitlements(),
    presetSettings: presetSettingsLoader(),
    ensureShop: shopOnboarding(),
    log: (event, data) => console.info(JSON.stringify({ event, ...data })),
  };
}

function shopOnboarding() {
  const sql = database();
  return sql ? (userId: string) => ensureUserShop(sql, userId) : null;
}

function presetSettingsLoader() {
  const db = database();
  return db ? () => loadPresetSettings(db) : null;
}

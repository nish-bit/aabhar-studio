import "server-only";

import { entitlementsLookup } from "@/server/billing/entitlements";
import { BillingRepository } from "@/server/billing/repository";
import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { DomainError } from "@/server/generation/domain-error";
import { SupabaseObjectStorage } from "@/server/generation/supabase-storage";

import { CatalogueRepository } from "./repository";
import type { CatalogueDeps } from "./service";

export function catalogueDeps(): CatalogueDeps {
  const db = database();
  const admin = supabaseAdmin();
  if (!db || !admin) {
    throw new DomainError("storage_not_configured", "The catalogue builder needs DATABASE_URL and Supabase storage to be configured.", 503);
  }
  return {
    repo: new CatalogueRepository(db),
    storage: new SupabaseObjectStorage(admin),
    entitlements: entitlementsLookup(new BillingRepository(db)),
  };
}

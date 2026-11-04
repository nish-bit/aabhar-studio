import "server-only";

import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { billingConfigState } from "@/server/billing/config";
import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { generationDeps } from "@/server/generation/deps";
import { DomainError } from "@/server/generation/domain-error";
import { runGenerationJob } from "@/server/generation/service";
import { getImageProvider } from "@/server/providers/image/registry";

import type { AdminDeps } from "./deps-types";

/** Kept in sync with the tag in src/server/billing/public-pricing.ts. */
export const PLANS_CACHE_TAG = "billing-plans";

/** Production wiring for the admin services. Never exposes any secret to the caller. */
export function adminDeps(): AdminDeps {
  const db = database();
  if (!db) throw new DomainError("storage_not_configured", "The admin dashboard needs DATABASE_URL to be configured.", 503);
  const auth = supabaseAdmin();
  const provider = getImageProvider();
  return {
    db,
    authAdmin: auth
      ? {
          async setBanned(userId, banned) {
            const { error } = await auth.auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
            if (error) throw new Error(error.message);
          },
        }
      : null,
    startJob: (jobId) => after(() => runGenerationJob(generationDeps(), jobId)),
    providerConfigured: provider !== null,
    provider: provider ? { id: provider.id, model: provider.model } : null,
    billingMode: billingConfigState().availability.mode,
    revalidatePlans: () => revalidateTag(PLANS_CACHE_TAG, "max"),
  };
}

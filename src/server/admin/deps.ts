import "server-only";

import { revalidateTag } from "next/cache";

import { billingConfigState } from "@/server/billing/config";
import { invalidatePublicPricingCache } from "@/server/billing/public-pricing";
import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";
import { generationDeps } from "@/server/generation/deps";
import { dispatchGenerationJob } from "@/server/generation/dispatch";
import { DomainError } from "@/server/generation/domain-error";
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
    // An admin retry always creates a new job, so a failed queue send may refund it at once.
    startJob: async (jobId) => {
      await dispatchGenerationJob(generationDeps(), jobId, { newJob: true });
    },
    providerConfigured: provider !== null,
    provider: provider ? { id: provider.id, model: provider.model } : null,
    billingMode: billingConfigState().availability.mode,
    revalidatePlans: () => {
      revalidateTag(PLANS_CACHE_TAG, "max");
      // Public pricing keeps a short in-memory cache per server instance; drop this instance's copy now.
      invalidatePublicPricingCache();
    },
  };
}

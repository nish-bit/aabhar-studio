import "server-only";

import { database } from "@/server/db/postgres";
import { serverEnv } from "@/server/env";

import type { CampaignDeps, MarketingEmailProvider } from "./campaigns";

/**
 * The configured marketing email provider. None is implemented yet, so this
 * returns null even when MARKETING_EMAIL_PROVIDER is set; add an adapter
 * (see ./campaigns.ts) before switching sending on.
 */
export function marketingProvider(): MarketingEmailProvider | null {
  const id = serverEnv().MARKETING_EMAIL_PROVIDER;
  if (!id) return null;
  console.warn(JSON.stringify({ event: "marketing.provider_not_implemented", provider: id }));
  return null;
}

/** Production wiring for sendCampaign. */
export function campaignDeps(): CampaignDeps | null {
  const db = database();
  if (!db) return null;
  const env = serverEnv();
  return { db, provider: marketingProvider(), enabled: env.MARKETING_EMAILS_ENABLED === "true", siteUrl: env.PUBLIC_SITE_URL ?? null };
}

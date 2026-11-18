import "server-only";

import { database } from "@/server/db/postgres";
import { DomainError } from "@/server/generation/domain-error";

import { billingConfigState } from "./config";
import { entitlementsLookup, type EntitlementsLookup } from "./entitlements";
import { RazorpayGateway } from "./gateway";
import { billingLog } from "./log";
import { BillingRepository } from "./repository";
import type { BillingDeps } from "./service";

/** Production wiring. Workers use the HYPERDRIVE binding; local Node uses DATABASE_URL.
 * Razorpay keys are optional (billing shows "not connected").
 */
export function billingDeps(): BillingDeps {
  const db = database();
  if (!db) throw new DomainError("storage_not_configured", "Billing database is not connected. Configure Cloudflare Hyperdrive in production or DATABASE_URL locally.", 503);
  const { config, availability } = billingConfigState();
  return {
    repo: new BillingRepository(db),
    gateway: config ? new RazorpayGateway(config.keyId, config.keySecret) : null,
    config,
    availability,
    log: billingLog,
  };
}

/** Plan limits for other services, or null when the database isn't connected. */
export function productionEntitlements(): EntitlementsLookup | null {
  const db = database();
  return db ? entitlementsLookup(new BillingRepository(db)) : null;
}

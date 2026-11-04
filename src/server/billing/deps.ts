import "server-only";

import { database } from "@/server/db/postgres";
import { DomainError } from "@/server/generation/domain-error";

import { billingConfigState } from "./config";
import { entitlementsLookup, type EntitlementsLookup } from "./entitlements";
import { RazorpayGateway } from "./gateway";
import { BillingRepository } from "./repository";
import type { BillingDeps } from "./service";

/** Production wiring. Needs DATABASE_URL; Razorpay keys are optional (billing shows "not connected"). */
export function billingDeps(): BillingDeps {
  const db = database();
  if (!db) throw new DomainError("storage_not_configured", "Billing needs DATABASE_URL to be configured.", 503);
  const { config, availability } = billingConfigState();
  return {
    repo: new BillingRepository(db),
    gateway: config ? new RazorpayGateway(config.keyId, config.keySecret) : null,
    config,
    availability,
    log: (event, data) => console.info(JSON.stringify({ event, ...data })),
  };
}

/** Plan limits for other services, or null when the database isn't connected. */
export function productionEntitlements(): EntitlementsLookup | null {
  const db = database();
  return db ? entitlementsLookup(new BillingRepository(db)) : null;
}

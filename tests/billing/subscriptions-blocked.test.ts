import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { billingConfig, paidPlans } from "@/config/billing";
import { BillingRepository } from "@/server/billing/repository";
import { changePlan, createSubscription, type BillingDeps } from "@/server/billing/service";
import { DomainError } from "@/server/generation/domain-error";

import { FakeGateway, KEY_ID, KEY_SECRET, WEBHOOK_SECRET } from "../support/fake-gateway";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Monthly plans are off sale (billingConfig.subscriptionsOnSale = false). Starting a subscription
 * and changing plan answer 503 subscriptions_unavailable, before Razorpay or the database is
 * touched, even when every plan has a synced Razorpay price (so the block doesn't depend on
 * plan_prices being empty).
 */

vi.setConfig({ testTimeout: 30_000 });

const env = vi.hoisted(() => ({ deps: null as unknown, user: null as null | { id: string; email: string | null } }));
vi.mock("@/server/auth/session", () => ({ getSessionUser: async () => env.user }));
vi.mock("@/server/auth/account-status", () => ({ isAccountDisabled: async () => false }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => undefined }));
vi.mock("@/server/billing/deps", () => ({ billingDeps: () => env.deps }));

let pg: PGlite;
let gateway: FakeGateway;
let deps: BillingDeps;
let user: { id: string; email: string | null };
let logged: string[];

beforeEach(async () => {
  let db;
  ({ pg, db } = await createTestDatabase());
  gateway = new FakeGateway();
  const repo = new BillingRepository(db);
  // Fully synced, as after a full `billing:sync --apply`: plans and an active Razorpay price for each paid plan.
  for (const [i, p] of billingConfig.plans.entries()) {
    await repo.upsertPlan({ id: p.id, name: p.name, monthlyCredits: p.monthlyCredits, limits: p.limits, isPaid: p.monthlyPricePaise !== null, sortOrder: i });
  }
  for (const p of paidPlans()) {
    await repo.insertPrice({ planId: p.id, mode: "test", amountPaise: p.monthlyPricePaise, razorpayPlanId: `plan_${p.id}_synced` });
  }
  logged = [];
  deps = {
    repo, gateway,
    availability: { enabled: true, mode: "test", keyId: KEY_ID, reason: null },
    config: { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, mode: "test" },
    log: (event) => void logged.push(event),
  };
  const u = await createUser(pg);
  user = { id: u.userId, email: "owner@example.test" };
  env.deps = deps;
  env.user = user;
}, 60_000);

async function expectBlocked(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "subscriptions_unavailable" && e.status === 503);
}

async function subscriptionRows() {
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from public.billing_subscriptions`);
  return rows[0]!.n;
}

describe("monthly subscriptions are off sale", () => {
  it("is the configured default", () => {
    expect(billingConfig.subscriptionsOnSale).toBe(false);
  });

  it("createSubscription answers 503 subscriptions_unavailable for every paid plan, without contacting Razorpay", async () => {
    for (const p of paidPlans()) await expectBlocked(createSubscription(deps, user, { planId: p.id }));
    expect(gateway.calls).toEqual([]);
    expect(await subscriptionRows()).toBe(0);
    expect(logged).toEqual(["billing.subscriptions_unavailable", "billing.subscriptions_unavailable", "billing.subscriptions_unavailable"]);
  });

  it("changePlan answers 503 subscriptions_unavailable, without contacting Razorpay", async () => {
    for (const p of paidPlans()) await expectBlocked(changePlan(deps, user.id, { planId: p.id }));
    expect(gateway.calls).toEqual([]);
  });

  it("is checked first: the same 503 even when Razorpay isn't configured or the plan is unknown", async () => {
    const off: BillingDeps = { ...deps, gateway: null, config: null };
    await expectBlocked(createSubscription(off, user, { planId: "growth" }));
    await expectBlocked(changePlan(off, user.id, { planId: "growth" }));
    await expectBlocked(createSubscription(deps, user, { planId: "nope" }));
  });

  it("only the explicit override lets the lifecycle tests through (the same request then reaches Razorpay)", async () => {
    const res = await createSubscription({ ...deps, subscriptionsOnSale: true }, user, { planId: "growth" });
    expect(res.subscriptionId).toBeTruthy();
    expect(gateway.calls).toEqual(["createSubscription"]);
  });
});

describe("subscription routes", () => {
  const ORIGIN = "http://localhost";
  const post = (p: string, body: unknown) =>
    new Request(`${ORIGIN}${p}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /api/billing/subscriptions answers 503 with a clear message", async () => {
    const { POST } = await import("@/app/api/billing/subscriptions/route");
    const res = await POST(post("/api/billing/subscriptions", { planId: "growth" }), undefined as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "subscriptions_unavailable", message: "Monthly plans aren't available right now. You can buy a credit pack instead." },
    });
    expect(gateway.calls).toEqual([]);
    expect(await subscriptionRows()).toBe(0);
  });

  it("POST /api/billing/subscriptions/change-plan answers 503 with a clear message", async () => {
    const { POST } = await import("@/app/api/billing/subscriptions/change-plan/route");
    const res = await POST(post("/api/billing/subscriptions/change-plan", { planId: "premium" }), undefined as never);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("subscriptions_unavailable");
    expect(gateway.calls).toEqual([]);
  });
});

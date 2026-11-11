import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { billingConfig, packById } from "@/config/billing";
import { pricingPacks } from "@/config/plans";

/**
 * getPublicPricing must always answer quickly with correct prices: overrides
 * when the database replies in time (cached), the last good overrides or the
 * config file otherwise, and never a price from the database.
 */

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  admin: null as null | { plans: () => Promise<Reply>; settings: () => Promise<Reply> },
  db: null as null | { query: (sql: string) => Promise<unknown[]> },
  signals: [] as AbortSignal[],
  reads: 0,
}));

vi.mock("@/server/db/supabase-admin", () => ({
  supabaseAdmin: () => {
    const a = state.admin;
    if (!a) return null;
    const query = (run: () => Promise<Reply>, counts: boolean) => {
      if (counts) state.reads++;
      const q = {
        select: () => q,
        not: () => q,
        eq: () => q,
        abortSignal: (s: AbortSignal) => (state.signals.push(s), q),
        maybeSingle: () => run(),
        then: (ok: (r: Reply) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
      };
      return q;
    };
    return { from: (table: string) => (table === "plans" ? query(a.plans, true) : query(a.settings, false)) };
  },
}));
vi.mock("@/server/db/postgres", () => ({ database: () => state.db }));

const {
  getPublicPricing,
  invalidatePublicPricingCache,
  DB_BUDGET_MS,
  PRICING_CACHE_TTL_MS,
  PRICING_RETRY_AFTER_FAILURE_MS,
  PRICING_STALE_MAX_MS,
} = await import("@/server/billing/public-pricing");

const configPrices = () => billingConfig.plans.map((p) => p.monthlyPricePaise);
const starterLimits = { ...billingConfig.plans[1]!.limits, maxCatalogues: 9 };
const ok = (data: unknown): Promise<Reply> => Promise.resolve({ data, error: null });
const goodDb = (credits = 123, trialCredits = 4) => ({
  plans: () => ok([{ id: "starter", monthly_credits: credits, limits: starterLimits }]),
  settings: () => ok({ trial_credits: trialCredits, trial_validity_days: 15 }),
});
const starterCredits = (r: Awaited<ReturnType<typeof getPublicPricing>>) => r.pricing.plans.find((p) => p.id === "starter")!.creditsPerMonth;

describe("getPublicPricing", () => {
  beforeEach(() => {
    invalidatePublicPricingCache();
    state.admin = null;
    state.db = null;
    state.signals = [];
    state.reads = 0;
    vi.useFakeTimers({ now: new Date("2026-11-10T10:00:00Z") });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it("uses the config file when nothing is configured", async () => {
    const r = await getPublicPricing();
    expect(r.source).toBe("config");
    expect(r.pricing.trialCredits).toBe(billingConfig.trial.credits);
  });

  it("applies valid overrides, without touching prices", async () => {
    state.admin = goodDb();
    const r = await getPublicPricing();
    expect(r.source).toBe("database");
    expect(r.pricing.trialCredits).toBe(4);
    expect(starterCredits(r)).toBe(123);
    expect(r.pricing.plans.map((p) => p.pricePaise.monthly)).toEqual(configPrices());
  });

  describe("cache", () => {
    it("serves a hit without reading the database again", async () => {
      state.admin = goodDb();
      await getPublicPricing();
      vi.advanceTimersByTime(PRICING_CACHE_TTL_MS - 1);
      const r = await getPublicPricing();
      expect(r.source).toBe("cache");
      expect(starterCredits(r)).toBe(123);
      expect(state.reads).toBe(1);
    });

    it("reads again once the entry expires", async () => {
      state.admin = goodDb(123);
      await getPublicPricing();
      state.admin = goodDb(456);
      vi.advanceTimersByTime(PRICING_CACHE_TTL_MS);
      const r = await getPublicPricing();
      expect(r.source).toBe("database");
      expect(starterCredits(r)).toBe(456);
      expect(state.reads).toBe(2);
    });

    it("shares one read between concurrent renders", async () => {
      state.admin = goodDb();
      const results = await Promise.all([getPublicPricing(), getPublicPricing(), getPublicPricing()]);
      expect(results.map((r) => r.source)).toEqual(["database", "database", "database"]);
      expect(state.reads).toBe(1);
    });

    it("is dropped by invalidatePublicPricingCache (admin plan/trial change)", async () => {
      state.admin = goodDb(123);
      await getPublicPricing();
      state.admin = goodDb(789);
      invalidatePublicPricingCache();
      const r = await getPublicPricing();
      expect(r.source).toBe("database");
      expect(starterCredits(r)).toBe(789);
    });

    it("doesn't let a read that started before an invalidation repopulate the cache", async () => {
      let release: ((r: Reply) => void) | undefined;
      state.admin = { plans: () => new Promise<Reply>((res) => (release = res)), settings: () => ok(null) };
      const early = getPublicPricing();
      for (let i = 0; i < 20 && !release; i++) await Promise.resolve(); // let the read start
      expect(release).toBeTypeOf("function");
      invalidatePublicPricingCache();
      release!({ data: [{ id: "starter", monthly_credits: 111, limits: starterLimits }], error: null });
      await early;
      state.admin = goodDb(222);
      expect(starterCredits(await getPublicPricing())).toBe(222);
    });
  });

  describe("timeout and failures", () => {
    it("falls back to config after the 2 s budget, cancels the requests, and doesn't retry for a while", async () => {
      const never = () => new Promise<Reply>(() => {});
      state.admin = { plans: never, settings: never };
      const pending = getPublicPricing();
      await vi.advanceTimersByTimeAsync(DB_BUDGET_MS);
      const r = await pending;
      expect(r.source).toBe("config");
      expect(r.pricing.plans.map((p) => p.pricePaise.monthly)).toEqual(configPrices());
      expect(state.signals.length).toBeGreaterThan(0);
      expect(state.signals.every((s) => s.aborted)).toBe(true);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`"event":"pricing.overrides_unavailable"`));

      // The next renders answer immediately from config instead of waiting another 2 s.
      const reads = state.reads;
      expect((await getPublicPricing()).source).toBe("config");
      expect(state.reads).toBe(reads);

      vi.advanceTimersByTime(PRICING_RETRY_AFTER_FAILURE_MS);
      state.admin = goodDb();
      expect((await getPublicPricing()).source).toBe("database");
    });

    it("keeps serving the last good overrides while the database is down, up to the stale limit", async () => {
      state.admin = goodDb(123);
      await getPublicPricing();
      state.admin = { plans: () => Promise.reject(new Error("ECONNRESET")), settings: () => ok(null) };
      vi.advanceTimersByTime(PRICING_CACHE_TTL_MS);
      const stale = await getPublicPricing();
      expect(stale.source).toBe("stale");
      expect(starterCredits(stale)).toBe(123);

      vi.advanceTimersByTime(PRICING_STALE_MAX_MS);
      const tooOld = await getPublicPricing();
      expect(tooOld.source).toBe("config");
      expect(starterCredits(tooOld)).toBe(billingConfig.plans[1]!.monthlyCredits);
    });

    it("falls back on an API error and logs it", async () => {
      state.admin = { plans: () => ok(null).then(() => ({ data: null, error: { message: "permission denied" } })), settings: () => ok(null) };
      const r = await getPublicPricing();
      expect(r.source).toBe("config");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    });

    it("doesn't leave an unhandled rejection when a late reply fails after the timeout", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      const late = () => new Promise<Reply>((_, reject) => setTimeout(() => reject(new Error("late")), 5_000));
      state.admin = { plans: late, settings: late };
      const pending = getPublicPricing();
      await vi.advanceTimersByTimeAsync(6_000);
      expect((await pending).source).toBe("config");
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));
      process.off("unhandledRejection", unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe("invalid overrides are ignored, never trusted", () => {
    it("drops unknown plans and out-of-range values, keeps valid ones, and reports each", async () => {
      state.admin = {
        plans: () =>
          ok([
            { id: "starter", monthly_credits: 150, limits: starterLimits }, // valid
            { id: "growth", monthly_credits: -5, limits: billingConfig.plans[2]!.limits }, // negative credits
            { id: "premium", monthly_credits: 900, limits: { ...billingConfig.plans[3]!.limits, maxActiveJobs: 999 } }, // limit out of range
            { id: "made-up-plan", monthly_credits: 10, limits: starterLimits }, // not a real plan
            { id: "trial", monthly_credits: 3, limits: "{not json" }, // corrupt JSON
          ]),
        settings: () => ok({ trial_credits: 5000, trial_validity_days: 30 }), // trial credits out of range
      };
      const r = await getPublicPricing();
      const byId = Object.fromEntries(r.pricing.plans.map((p) => [p.id, p]));
      expect(byId.starter!.creditsPerMonth).toBe(150);
      expect(byId.growth!.creditsPerMonth).toBe(billingConfig.plans[2]!.monthlyCredits);
      expect(byId.premium!.creditsPerMonth).toBe(billingConfig.plans[3]!.monthlyCredits);
      expect(r.pricing.trialCredits).toBe(billingConfig.trial.credits);
      expect(r.pricing.plans.map((p) => p.pricePaise.monthly)).toEqual(configPrices());
      const invalid = vi.mocked(console.error).mock.calls.filter(([m]) => String(m).includes("pricing.override_invalid"));
      expect(invalid.map(([m]) => JSON.parse(String(m)).override).sort()).toEqual(["growth", "made-up-plan", "premium", "trial", "trial"]);
    });
  });

  it("uses Postgres when only DATABASE_URL is configured, with the same validation", async () => {
    state.db = {
      query: async (sql: string) =>
        sql.includes("billing_settings")
          ? [{ credits: 7, validityDays: 30 }]
          : [
              { id: "starter", monthlyCredits: 50, limits: JSON.stringify(starterLimits) },
              { id: "growth", monthlyCredits: 50, limits: { maxActiveJobs: "lots" } },
            ],
    };
    const r = await getPublicPricing();
    expect(r.source).toBe("database");
    expect(r.pricing.trialCredits).toBe(7);
    expect(starterCredits(r)).toBe(50);
    expect(r.pricing.plans.find((p) => p.id === "growth")!.creditsPerMonth).toBe(billingConfig.plans[2]!.monthlyCredits);
  });
});

describe("pack prices: one source for the pricing page and order creation", () => {
  it("keeps the approved paid packs", () => {
    const pick = (id: string) => {
      const p = packById(id)!;
      return { name: p.name, rupees: p.pricePaise / 100, credits: p.credits };
    };
    expect(pick("solo")).toEqual({ name: "Solo", rupees: 1499, credits: 20 });
    expect(pick("signature")).toEqual({ name: "Signature", rupees: 3999, credits: 75 });
    expect(pick("studio")).toEqual({ name: "Studio", rupees: 19999, credits: 500 });
  });

  it("shows exactly the ids, prices and credits that createPackOrder charges (packById)", () => {
    for (const shown of pricingPacks) {
      const charged = packById(shown.id)!;
      expect({ id: shown.id, pricePaise: shown.pricePaise, credits: shown.credits }).toEqual({
        id: charged.id,
        pricePaise: charged.pricePaise,
        credits: charged.credits,
      });
    }
    expect(pricingPacks.map((p) => p.id)).toEqual(billingConfig.packs.map((p) => p.id));
  });
});

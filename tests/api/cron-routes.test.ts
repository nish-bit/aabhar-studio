import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The /api/cron/* routes the Worker's Cron Triggers call (worker.ts →
 * src/worker/background.ts). Each one runs its task only for
 * `Authorization: Bearer $CRON_SECRET`, and never when no secret is set.
 */

const ran = vi.hoisted(() => [] as string[]);
/** missing: storage/database not configured. failure: setup fails for another reason (a plain error, or a DomainError with another code). */
const storage = vi.hoisted(() => ({
  missing: false,
  failure: null as "plain" | "other-domain-error" | null,
  /** The DomainError class the route under test was loaded with (see call()). */
  DomainError: null as null | (new (code: "storage_not_configured" | "internal_error", message: string, status: number) => Error),
}));

// Every call re-imports the route (vi.resetModules), which loads a fresh DomainError class, but
// Vitest doesn't re-run mock factories after a reset. So the mocks throw the class call() recorded:
// the same one the route checks with `instanceof`.
vi.mock("@/server/generation/deps", () => {
  return {
    generationDeps: () => {
      const DomainError = storage.DomainError!;
      if (storage.missing) throw new DomainError("storage_not_configured", "Storage and database aren't connected yet.", 503);
      if (storage.failure === "plain") throw new Error("unexpected boom");
      if (storage.failure === "other-domain-error") throw new DomainError("internal_error", "Something else broke.", 500);
      return { repo: { expireStaleJobs: async () => (ran.push("expire-jobs"), 2) } };
    },
  };
});
vi.mock("@/server/billing/deps", () => {
  return {
    billingDeps: () => {
      const DomainError = storage.DomainError!;
      if (storage.missing) throw new DomainError("storage_not_configured", "Billing needs DATABASE_URL to be configured.", 503);
      if (storage.failure === "plain") throw new Error("unexpected boom");
      if (storage.failure === "other-domain-error") throw new DomainError("internal_error", "Something else broke.", 500);
      return {};
    },
  };
});
vi.mock("@/server/billing/service", () => ({
  reconcileBilling: async () => (ran.push("billing"), { expired: 1, ordersConfirmed: 0 }),
}));
vi.mock("@/server/db/postgres", () => ({ database: () => (storage.missing ? null : {}) }));
vi.mock("@/server/db/supabase-admin", () => ({ supabaseAdmin: () => (storage.missing ? null : {}) }));
vi.mock("@/server/generation/supabase-storage", () => ({ SupabaseObjectStorage: class {} }));
vi.mock("@/server/privacy/retention", () => ({ runRetention: async () => (ran.push("retention"), { deleted: 0 }) }));

const SECRET = "cron-secret-".padEnd(40, "z");
const ROUTES = ["expire-jobs", "billing", "retention"] as const;

async function call(route: (typeof ROUTES)[number], authorization?: string) {
  vi.resetModules(); // serverEnv() caches the environment per module instance
  const { GET } = (await import(`@/app/api/cron/${route}/route`)) as { GET: (req: Request) => Promise<Response> };
  storage.DomainError = (await import("@/server/generation/domain-error")).DomainError;
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return GET(new Request(`https://www.aabharstudio.com/api/cron/${route}`, { headers }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  ran.length = 0;
  storage.missing = false;
  storage.failure = null;
});

describe("cron routes", () => {
  it("run their task with the right CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const route of ROUTES) {
      const res = await call(route, `Bearer ${SECRET}`);
      expect(res.status, route).toBe(200);
    }
    expect(ran).toEqual(["expire-jobs", "billing", "retention"]);
  });

  it("refuse missing or wrong credentials with 401, without running anything", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const route of ROUTES) {
      // (Surrounding whitespace isn't a different credential: the Fetch standard trims header values.)
      for (const authorization of [undefined, "", `Bearer ${SECRET.slice(0, -1)}x`, SECRET, `Bearer ${SECRET}${SECRET}`, `bearer ${SECRET}`]) {
        expect((await call(route, authorization)).status, `${route} ${String(authorization)}`).toBe(401);
      }
    }
    expect(ran).toEqual([]);
  });

  it("answer 401 (not a 500) to non-ASCII credentials, including ones as long as the real header in characters", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    // "é" is one character but two UTF-8 bytes; this used to make timingSafeEqual throw.
    const sameCharLength = `Bearer ${"é".repeat(SECRET.length)}`;
    expect(sameCharLength.length).toBe(`Bearer ${SECRET}`.length);
    for (const route of ROUTES) {
      for (const authorization of [sameCharLength, `Bearer ${SECRET.slice(0, -1)}é`, `Bearer ${"ÿ".repeat(8)}`]) {
        const res = await call(route, authorization);
        expect(res.status, `${route} ${authorization}`).toBe(401);
        expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Unauthorized." } });
      }
    }
    expect(ran).toEqual([]);
  });

  it("answer 503 storage_not_configured when storage is unavailable, all three alike", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    storage.missing = true;
    for (const route of ROUTES) {
      const res = await call(route, `Bearer ${SECRET}`);
      expect(res.status, route).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code, route).toBe("storage_not_configured");
    }
    expect(ran).toEqual([]);
  });

  it("check the secret before storage: unauthorized callers get 401 even when storage is missing", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    storage.missing = true;
    for (const route of ROUTES) expect((await call(route, "Bearer wrong")).status, route).toBe(401);
  });

  it("don't turn other setup failures into 503: they still surface as errors (500)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const [failure, message] of [["plain", "unexpected boom"], ["other-domain-error", "Something else broke."]] as const) {
      storage.failure = failure;
      for (const route of ["expire-jobs", "billing"] as const) {
        await expect(call(route, `Bearer ${SECRET}`), `${route}: ${failure}`).rejects.toThrow(message);
      }
    }
    expect(ran).toEqual([]);
  });

  it("stay closed when CRON_SECRET isn't configured, even for an empty bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const route of ROUTES) {
      expect((await call(route, "Bearer ")).status, route).toBe(401);
      expect((await call(route, "Bearer undefined")).status, route).toBe(401);
    }
    expect(ran).toEqual([]);
  });
});

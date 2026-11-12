import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * integrationStatus().database must follow the same rule as database()
 * (src/server/db/postgres.ts): on Cloudflare Workers only the HYPERDRIVE
 * binding counts, on Node (dev, scripts, tests) only DATABASE_URL.
 */

const cf = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  throws: false,
  calls: 0,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    cf.calls++;
    if (cf.throws) throw new Error("getCloudflareContext called outside a request");
    return { env: cf.env, ctx: {}, cf: undefined };
  },
}));

const DIRECT_URL = "postgres://direct@db.example.com:5432/postgres";
const HYPERDRIVE = { connectionString: "postgres://hd@hyperdrive.local:5432/postgres" };

/** Loads env.ts fresh, so its runtime detection and cached env see the current stubs. */
async function loadStatus(runtime: "workers" | "node", databaseUrl?: string) {
  vi.resetModules();
  if (runtime === "workers") vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  vi.stubEnv("DATABASE_URL", databaseUrl ?? "");
  const { integrationStatus } = await import("@/server/env");
  return integrationStatus();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  cf.env = {};
  cf.throws = false;
  cf.calls = 0;
});

describe("integrationStatus().database on Cloudflare Workers", () => {
  it("is true with a HYPERDRIVE binding, even without DATABASE_URL", async () => {
    cf.env = { HYPERDRIVE };
    expect((await loadStatus("workers")).database).toBe(true);
  });

  it("is false without a HYPERDRIVE binding, even when DATABASE_URL is set", async () => {
    expect((await loadStatus("workers", DIRECT_URL)).database).toBe(false);
  });

  it("is false when the binding has no connection string", async () => {
    cf.env = { HYPERDRIVE: {} };
    expect((await loadStatus("workers")).database).toBe(false);
  });

  it("is false, without throwing, when called outside a request", async () => {
    cf.throws = true;
    expect((await loadStatus("workers", DIRECT_URL)).database).toBe(false);
  });
});

describe("integrationStatus().database on Node", () => {
  it("is true with DATABASE_URL", async () => {
    expect((await loadStatus("node", DIRECT_URL)).database).toBe(true);
  });

  it("is false without DATABASE_URL", async () => {
    expect((await loadStatus("node")).database).toBe(false);
  });

  it("ignores the Cloudflare context entirely", async () => {
    cf.env = { HYPERDRIVE };
    expect((await loadStatus("node")).database).toBe(false);
    expect(cf.calls).toBe(0);
  });
});

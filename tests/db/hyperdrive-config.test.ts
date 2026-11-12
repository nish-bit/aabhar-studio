import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * database() on Cloudflare Workers with and without a usable HYPERDRIVE
 * binding: never a direct DATABASE_URL connection, a short connect timeout so
 * an unreachable database fails fast instead of hanging the request, and one
 * log line (not one per request) when the binding is missing.
 */

const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown>, ctx: {} as object }));
const created = vi.hoisted(() => [] as { url: string; options: Record<string, unknown> }[]);

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env, ctx: cf.ctx, cf: undefined }) }));
vi.mock("postgres", () => ({
  default: (url: string, options: Record<string, unknown>) => {
    created.push({ url, options });
    return { unsafe: async () => [], begin: async () => undefined };
  },
}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgres://direct@db.example.com:5432/postgres", DATABASE_POOL_MAX: 5 }) }));

async function loadDatabase() {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  return (await import("@/server/db/postgres")).database;
}

afterEach(() => {
  vi.unstubAllGlobals();
  created.length = 0;
  cf.env = {};
  cf.ctx = {};
});

describe("database() on Workers: Hyperdrive configuration", () => {
  it("connects through the binding with a 5 s connect timeout, no prepared statements and no direct URL", async () => {
    const database = await loadDatabase();
    cf.env = { HYPERDRIVE: { connectionString: "postgres://hd@hyperdrive.local:5432/postgres" } };
    expect(database()).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("postgres://hd@hyperdrive.local:5432/postgres");
    expect(created[0]!.options).toMatchObject({ connect_timeout: 5, idle_timeout: 5, prepare: false, max: 5 });
    expect(created[0]!.options).not.toHaveProperty("ssl"); // Hyperdrive verifies Supabase's certificate itself
  });

  it("treats a binding without a connection string as missing", async () => {
    const database = await loadDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    cf.env = { HYPERDRIVE: { connectionString: "" } };
    expect(database()).toBeNull();
    expect(created).toEqual([]);
  });

  it("logs a missing binding once, not on every request, and never falls back to DATABASE_URL", async () => {
    const database = await loadDatabase();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      cf.ctx = {}; // a new request each time
      expect(database()).toBeNull();
    }
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toContain("database.not_configured");
    expect(created).toEqual([]);
  });

  it("returns null outside a request instead of throwing", async () => {
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => {
        throw new Error("outside a request");
      },
    }));
    try {
      const database = await loadDatabase();
      expect(database()).toBeNull();
      expect(created).toEqual([]);
    } finally {
      vi.doUnmock("@opennextjs/cloudflare");
    }
  });
});

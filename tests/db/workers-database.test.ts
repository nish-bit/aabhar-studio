import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On Cloudflare Workers, database() must use the Hyperdrive binding with one
 * client per request (sharing a socket across requests hangs the Worker),
 * and must never fall back to a direct DATABASE_URL connection.
 */

const cf = vi.hoisted(() => ({ ctx: {} as object, env: {} as Record<string, unknown> }));
const created = vi.hoisted(() => [] as string[]);

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env, ctx: cf.ctx, cf: undefined }) }));
vi.mock("postgres", () => ({
  default: (url: string) => {
    created.push(url);
    return { unsafe: async () => [], begin: async () => undefined };
  },
}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgres://direct@db.example.com:5432/postgres", DATABASE_POOL_MAX: 5 }) }));

vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
const { database } = await import("@/server/db/postgres");

describe("database() on Cloudflare Workers", () => {
  beforeEach(() => {
    created.length = 0;
    cf.ctx = {};
    cf.env = {};
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns null without a HYPERDRIVE binding, and never connects to DATABASE_URL directly", () => {
    expect(database()).toBeNull();
    expect(created).toEqual([]);
  });

  it("uses Hyperdrive with one client per request", () => {
    cf.env = { HYPERDRIVE: { connectionString: "postgres://hd@hyperdrive.local:5432/postgres" } };
    const first = database();
    expect(first).not.toBeNull();
    expect(database()).toBe(first); // same request: same client
    cf.ctx = {}; // next request
    const second = database();
    expect(second).not.toBe(first);
    expect(created).toEqual(["postgres://hd@hyperdrive.local:5432/postgres", "postgres://hd@hyperdrive.local:5432/postgres"]);
  });
});

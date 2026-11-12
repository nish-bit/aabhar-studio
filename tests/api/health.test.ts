import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/health: the uptime check. 200 only when the database answers;
 * 503 (and no hang, no leaked details) when Hyperdrive is missing, the
 * database is unreachable or the connection times out.
 */

const state = vi.hoisted(() => ({ db: null as null | { query: () => Promise<unknown[]> } }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("@/server/db/postgres", () => ({ database: () => state.db }));
vi.mock("@/server/env", () => ({
  integrationStatus: () => ({ supabase: true, database: state.db !== null, imageProvider: true, providerLabel: "OpenAI test" }),
}));
vi.mock("@/server/billing/config", () => ({ billingConfigState: () => ({ availability: { enabled: false, mode: null } }) }));

async function health() {
  const { GET } = await import("@/app/api/health/route");
  const res = await GET();
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

beforeEach(() => {
  state.db = null;
});

describe("health check", () => {
  it("is 200 with database: true when the database answers", async () => {
    state.db = { query: async () => [{ ok: 1 }] };
    const { status, body, cache } = await health();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, database: true });
    expect(cache).toBe("no-store");
  });

  it("is 503 with database: false when Hyperdrive isn't configured", async () => {
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, database: false, auth: true });
  });

  it("is 503, without throwing or leaking the error, when the connection times out", async () => {
    state.db = { query: () => Promise.reject(new Error("write CONNECT_TIMEOUT hyperdrive.local:5432")) };
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, database: false });
    expect(JSON.stringify(body)).not.toMatch(/CONNECT_TIMEOUT|hyperdrive/);
  });

  it("is 503 when the database answers something unexpected", async () => {
    state.db = { query: async () => [] };
    expect((await health()).status).toBe(503);
  });

  it("reveals booleans and timings only", async () => {
    state.db = { query: async () => [{ ok: 1 }] };
    const { body } = await health();
    expect(Object.keys(body).sort()).toEqual(["auth", "database", "dbLatencyMs", "imageProvider", "ok", "payments", "release"]);
  });
});

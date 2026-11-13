import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * When Supabase counts as not configured, the server logs once which of the three variables
 * are present, blank or missing (in process.env and, on Workers, in the env bindings), and
 * what the app's parsed configuration saw. Never values, lengths or prefixes.
 */

const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env, ctx: {}, cf: undefined }) }));

const VALUES = {
  NEXT_PUBLIC_SUPABASE_URL: "https://diag-ref-value.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_DIAGNOSTIC_VALUE_1",
  SUPABASE_SECRET_KEY: "sb_secret_DIAGNOSTIC_VALUE_123456",
};

async function load(env: Partial<Record<keyof typeof VALUES, string | undefined>>, opts: { workers?: boolean; nodeEnv?: string } = {}) {
  vi.resetModules();
  if (opts.workers) vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  vi.stubEnv("NODE_ENV", opts.nodeEnv ?? "production");
  for (const k of Object.keys(VALUES) as (keyof typeof VALUES)[]) vi.stubEnv(k, env[k]);
  return import("@/server/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cf.env = {};
});

describe("Supabase configuration diagnostics", () => {
  it("reports present / blank / missing per variable, outside Workers", async () => {
    const m = await load({ NEXT_PUBLIC_SUPABASE_URL: VALUES.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   ", SUPABASE_SECRET_KEY: undefined });
    expect(m.supabaseEnvPresence()).toEqual({
      processEnv: { NEXT_PUBLIC_SUPABASE_URL: "present", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "blank", SUPABASE_SECRET_KEY: "missing" },
      workerEnv: null,
    });
  });

  it("on Workers, also reports the env bindings separately from process.env", async () => {
    cf.env = { NEXT_PUBLIC_SUPABASE_URL: "x", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "y", SUPABASE_SECRET_KEY: "" };
    const m = await load({ ...VALUES, SUPABASE_SECRET_KEY: undefined }, { workers: true });
    expect(m.supabaseEnvPresence().workerEnv).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "present", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "present", SUPABASE_SECRET_KEY: "blank" });
    expect(m.supabaseEnvPresence().processEnv.SUPABASE_SECRET_KEY).toBe("missing");
  });

  it("logs once per instance when not configured, with states only and never a value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await load({ ...VALUES, SUPABASE_SECRET_KEY: "  " });
    expect(m.supabaseConfig()).toBeNull();
    expect(m.supabaseConfig()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: "auth.supabase_not_configured",
      parsedByApp: { NEXT_PUBLIC_SUPABASE_URL: true, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: true, SUPABASE_SECRET_KEY: false },
      processEnv: { NEXT_PUBLIC_SUPABASE_URL: "present", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "present", SUPABASE_SECRET_KEY: "blank" },
      workerEnv: null,
    });
    for (const v of Object.values(VALUES)) expect(line).not.toContain(v);
    expect(line).not.toMatch(/DIAGNOSTIC|diag-ref/);
  });

  it("doesn't log when Supabase is configured, or during tests", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await load(VALUES)).supabaseConfig()).not.toBeNull();
    expect((await load({}, { nodeEnv: "test" })).supabaseConfig()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

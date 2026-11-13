import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * /login decides between the Google button and the "Sign-in not connected" notice from the
 * runtime environment. It must render per request (connection()), not at build time: on
 * Cloudflare, SUPABASE_SECRET_KEY is a Worker secret that a Workers Builds build never has,
 * so a prerendered page showed "not connected" even when the Worker was fully configured.
 */

// The first import of the page's module graph is slow on a cold run.
vi.setConfig({ testTimeout: 30_000 });

const calls = vi.hoisted(() => [] as string[]);
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => void calls.push("connection"),
}));
vi.mock("@/server/billing/public-pricing", () => ({
  getPublicPricing: async () => (calls.push("pricing"), { pricing: { trialCredits: 2 } }),
}));

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_value_123",
  SUPABASE_SECRET_KEY: "sb_secret_test_key_value_1234567",
};

async function render() {
  vi.resetModules(); // serverEnv() caches the environment per module instance
  const { default: LoginPage } = await import("@/app/(auth)/login/page");
  const { GoogleSignIn } = await import("@/components/auth/google-sign-in");
  const { IntegrationNotice } = await import("@/components/studio/integration-notice");
  const tree = await LoginPage();
  const found = new Set<string>();
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === GoogleSignIn) found.add("google");
    if (el.type === IntegrationNotice) found.add("notice");
    walk(el.props.children);
  };
  walk(tree);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
});

describe("/login", () => {
  it("waits for a request before reading the configuration (so it's never prerendered with build-time values)", async () => {
    for (const [k, v] of Object.entries(SUPABASE)) vi.stubEnv(k, v);
    await render();
    expect(calls[0]).toBe("connection");
  });

  it("shows the Google button when Supabase is configured at runtime", async () => {
    for (const [k, v] of Object.entries(SUPABASE)) vi.stubEnv(k, v);
    expect([...(await render())]).toEqual(["google"]);
  });

  it("shows the 'not connected' notice when any of the three values is missing", async () => {
    for (const missing of Object.keys(SUPABASE)) {
      for (const [k, v] of Object.entries(SUPABASE)) vi.stubEnv(k, k === missing ? "" : v);
      expect([...(await render())], missing).toEqual(["notice"]);
      vi.unstubAllEnvs();
    }
  });
});

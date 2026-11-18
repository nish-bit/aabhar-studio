import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The full PKCE round trip with the real @supabase/ssr client (only the network and the cookie
 * jar are simulated): starting Google sign-in stores a code-verifier cookie; /auth/callback
 * sends the code together with that verifier to Supabase, stores the session in cookies,
 * clears the verifier and redirects to the dashboard. Also: no verifier, no session.
 */

vi.setConfig({ testTimeout: 30_000 });

const SUPABASE_URL = "https://testref.supabase.co";
const KEY = "sb_publishable_callback_test_key";
const CODE = "0b6f3f8e-7d7c-4a7e-9a55-3f0f1e2d4c5b";

/** In-memory cookie jar standing in for next/headers cookies(). */
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].filter(([, c]) => c.value !== "").map(([name, c]) => ({ name, value: c.value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (value === "" || options?.maxAge === 0) jar.delete(name);
      else jar.set(name, { value, options });
    },
  }),
}));
vi.mock("@/server/db/postgres", () => ({ database: () => null }));

type TokenCall = { grantType: string | null; body: { auth_code?: string; code_verifier?: string } };
let tokenCalls: TokenCall[];
let tokenResponse: () => Response;

const session = () => ({
  access_token: "header.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjk5OTk5OTk5OTl9.sig",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "refresh-token-value",
  user: { id: "11111111-2222-4333-8444-555555555555", aud: "authenticated", role: "authenticated", email: "jeweller@example.test", app_metadata: { provider: "google" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
});

beforeEach(() => {
  jar.clear();
  tokenCalls = [];
  tokenResponse = () => Response.json(session());
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_callback_test_value_000");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === SUPABASE_URL && url.pathname === "/auth/v1/token") {
      tokenCalls.push({ grantType: url.searchParams.get("grant_type"), body: JSON.parse(String(init?.body ?? "{}")) });
      return tokenResponse();
    }
    throw new Error(`unexpected network call in test: ${url.origin}${url.pathname}`);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** What the browser does on "Continue with Google": the real client stores the PKCE verifier cookie. */
async function startSignIn() {
  const client = createServerClient(SUPABASE_URL, KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => (value ? jar.set(name, { value, options }) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fapp%2Fdashboard", skipBrowserRedirect: true },
  });
  expect(error).toBeNull();
  return new URL(data.url!);
}

async function callback(query: string) {
  vi.resetModules(); // fresh serverEnv() for the stubbed environment
  const { GET } = await import("@/app/auth/callback/route");
  const cookieHeader = [...jar].map(([n, c]) => `${n}=${c.value}`).join("; ");
  return GET(new Request(`http://localhost:3000/auth/callback?${query}`, { headers: { cookie: cookieHeader } }));
}

/**
 * @supabase/ssr 0.12 writes the verifier to a fixed cookie (sb-<ref>-auth-token-code-verifier) plus a
 * per-attempt slot (…-flow-<id>-code-verifier) and an index (…-flows-code-verifier). The OAuth callback
 * URL carries no flow id, so the exchange uses (and then removes) the fixed cookie; the library evicts
 * the per-attempt slots itself.
 */
const FIXED_VERIFIER = "sb-testref-auth-token-code-verifier";
const verifierCookie = () => (jar.has(FIXED_VERIFIER) ? FIXED_VERIFIER : undefined);
/** Cookie values are stored as "base64-" + base64(JSON). */
const decodeCookie = (v: string): unknown => JSON.parse(v.startsWith("base64-") ? Buffer.from(v.slice(7), "base64").toString("utf8") : v);
const sessionCookies = () => [...jar.keys()].filter((n) => /^sb-testref-auth-token(\.\d+)?$/.test(n));

describe("Google sign-in PKCE round trip", () => {
  it("starting sign-in stores a PKCE verifier cookie and asks Supabase for our callback with a code challenge", async () => {
    const authorize = await startSignIn();
    expect(authorize.pathname).toBe("/auth/v1/authorize");
    expect(authorize.searchParams.get("provider")).toBe("google");
    expect(authorize.searchParams.get("redirect_to")).toBe("http://localhost:3000/auth/callback?next=%2Fapp%2Fdashboard");
    expect(authorize.searchParams.get("code_challenge_method")).toMatch(/^s256$/i);
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    expect(verifierCookie()).toBeTruthy();
    expect(decodeCookie(jar.get(verifierCookie()!)!.value)).toEqual(expect.any(String));
    expect(tokenCalls).toEqual([]); // nothing exchanged yet
  });

  it("the callback exchanges the code with that verifier, stores the session cookie, clears the verifier and goes to the dashboard", async () => {
    await startSignIn();
    const storedVerifier = decodeCookie(jar.get(verifierCookie()!)!.value) as string;

    const res = await callback(`code=${CODE}&next=%2Fapp%2Fdashboard`);

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app/dashboard");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.grantType).toBe("pkce");
    expect(tokenCalls[0]!.body.auth_code).toBe(CODE);
    // Exactly the verifier this browser stored when the sign-in started.
    expect(storedVerifier.length).toBeGreaterThanOrEqual(43);
    expect(tokenCalls[0]!.body.code_verifier).toBe(storedVerifier);
    expect(sessionCookies().length).toBeGreaterThan(0); // the session persists for later requests
    expect(verifierCookie()).toBeUndefined(); // single use
    for (const name of sessionCookies()) expect(jar.get(name)!.options).toMatchObject({ path: "/", sameSite: "lax" });
  });

  it("the stray-code fallback lands on the same exchange and the dashboard", async () => {
    await startSignIn();
    // What the proxy forwards a /?code=… to (see tests/auth/root-code-forwarding.test.ts).
    const res = await callback(`code=${CODE}&next=%2Fapp%2Fdashboard`);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app/dashboard");
    expect(tokenCalls).toHaveLength(1);
    expect(sessionCookies().length).toBeGreaterThan(0);
  });

  it("without the verifier cookie (another browser, or cookie lost) there is no exchange and no session", async () => {
    const res = await callback(`code=${CODE}&next=%2Fapp%2Fdashboard`);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("expired");
    expect(sessionCookies()).toEqual([]);
  });

  it("an unknown or reused code (Supabase has no flow state for it): back to login as expired, no session cookie", async () => {
    await startSignIn();
    tokenResponse = () => Response.json({ code: 404, error_code: "flow_state_not_found", msg: "invalid flow state, no valid flow state found" }, { status: 404 });
    const res = await callback(`code=${CODE}&next=%2Fapp%2Fdashboard`);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("expired");
    expect(sessionCookies()).toEqual([]);
  });

  it("any other rejection of the code: back to login as failed, no session cookie", async () => {
    await startSignIn();
    tokenResponse = () => Response.json({ code: 400, error_code: "validation_failed", msg: "invalid request" }, { status: 400 });
    const res = await callback(`code=${CODE}&next=%2Fapp%2Fdashboard`);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("failed");
    expect(sessionCookies()).toEqual([]);
  });

  it("a missing code never contacts Supabase", async () => {
    await startSignIn();
    const res = await callback("next=%2Fapp%2Fdashboard");
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("callback");
    expect(tokenCalls).toEqual([]);
    expect(sessionCookies()).toEqual([]);
  });

  it("an off-site next is replaced by the dashboard even after a successful exchange", async () => {
    await startSignIn();
    const res = await callback(`code=${CODE}&next=${encodeURIComponent("https://evil.example/steal")}`);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("http://localhost:3000");
    expect(to.pathname).toBe("/app/dashboard");
  });
});

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session handling behind the dashboard redirect loop:
 * - the proxy must keep refreshed session cookies when it redirects;
 * - getSessionUser must treat "no session" as signed out, but a Supabase
 *   outage as an error (not a reason to send the user to /login).
 */
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  refresh: false,
  error: null as { name: string; status?: number; code?: string } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[], h?: object) => void } }) => ({
    auth: {
      getUser: async () => {
        // Simulate Supabase rotating an expired session during the check.
        if (state.refresh) opts.cookies.setAll([{ name: "sb-test-auth-token", value: "rotated", options: { path: "/", httpOnly: true } }], {});
        return { data: { user: state.user }, error: state.error };
      },
    },
  }),
}));
vi.mock("@/server/db/supabase-server", () => ({
  supabaseForRequest: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: state.error }) } }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));

const ORIGIN = "https://aabhar.example";
const run = async (path: string) => (await import("@/proxy")).proxy(new NextRequest(new URL(path, ORIGIN)));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  Object.assign(state, { user: null, refresh: false, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy keeps refreshed session cookies on redirects", () => {
  it("signed in at /login: the redirect to the dashboard carries the rotated session", async () => {
    Object.assign(state, { user: { id: "u1" }, refresh: true });
    const res = await run("/login?next=/app/dashboard");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app/dashboard");
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("rotated");
  });

  it("signed out at /app: the redirect to /login also carries any cookie changes", async () => {
    Object.assign(state, { user: null, refresh: true });
    const res = await run("/app/dashboard");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("rotated");
  });
});

describe("getSessionUser", () => {
  it("returns the user, or null when there's simply no valid session", async () => {
    const { getSessionUser, isSignedOutError } = await import("@/server/auth/session");
    state.user = { id: "u1" };
    expect(await getSessionUser()).toMatchObject({ id: "u1" });
    Object.assign(state, { user: null, error: { name: "AuthSessionMissingError", status: 400 } });
    expect(await getSessionUser()).toBeNull();
    expect(isSignedOutError({ name: "AuthApiError", status: 403, code: "bad_jwt" } as never)).toBe(true);
  });

  it("throws (instead of pretending you're signed out) when Supabase is unreachable or rate-limited", async () => {
    const { getSessionUser } = await import("@/server/auth/session");
    state.error = { name: "AuthRetryableFetchError" };
    await expect(getSessionUser()).rejects.toThrow(/verify the session/);
    state.error = { name: "AuthApiError", status: 429 };
    await expect(getSessionUser()).rejects.toThrow(/429/);
    state.error = { name: "AuthApiError", status: 503 };
    await expect(getSessionUser()).rejects.toThrow(/503/);
  });
});

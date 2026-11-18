import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When Supabase can't use the requested redirect URL it falls back to the Site URL root with
 * ?code=…. The proxy forwards that code to /auth/callback (fixed destination /app/dashboard),
 * where it's exchanged with the usual PKCE check. OAuth errors keep their existing handling.
 */

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));

const ORIGIN = "http://localhost:3000";
const CODE = "6f1c2a9e-1b2c-4d3e-8f90-123456789abc";

async function runProxy(path: string) {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(path, ORIGIN)));
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  getUser.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a sign-in code that lands on the site root", () => {
  it("is forwarded once to /auth/callback on the same origin, with the fixed dashboard destination", async () => {
    const res = await runProxy(`/?code=${CODE}`);
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/auth/callback");
    expect([...to.searchParams.keys()].sort()).toEqual(["code", "next"]);
    expect(to.searchParams.get("code")).toBe(CODE);
    expect(to.searchParams.get("next")).toBe("/app/dashboard");
    expect(getUser).not.toHaveBeenCalled(); // no session work on "/"
  });

  it("ignores any destination in the query: only /app/dashboard is ever used", async () => {
    for (const next of ["https://evil.example/x", "//evil.example", "/admin", "/\\evil.example"]) {
      const res = await runProxy(`/?code=${CODE}&next=${encodeURIComponent(next)}&redirect_to=${encodeURIComponent(next)}`);
      expect(new URL(res.headers.get("location")!).searchParams.get("next"), next).toBe("/app/dashboard");
      expect(new URL(res.headers.get("location")!).origin).toBe(ORIGIN);
    }
  });

  it("logs a warning that says what to fix, never the code", async () => {
    await runProxy(`/?code=${CODE}`);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(JSON.parse(line).event).toBe("auth.oauth_code_at_root");
    expect(line).toMatch(/Redirect URLs/);
    expect(line).not.toContain(CODE);
    expect(line).not.toContain("6f1c2a9e");
  });

  it("leaves OAuth errors to the existing handling, even when a code is present too", async () => {
    const expired = await runProxy(`/?code=${CODE}&error=invalid_request&error_code=bad_oauth_state&error_description=expired`);
    const to = new URL(expired.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("expired");
    expect(to.searchParams.has("code")).toBe(false);

    // Partial error parameters aren't a Supabase auth error (so no login redirect), but they still block forwarding.
    expect((await runProxy(`/?code=${CODE}&error=just-a-word`)).headers.get("location")).toBeNull();
    expect((await runProxy(`/?code=${CODE}&error_description=x`)).headers.get("location")).toBeNull();
    expect((await runProxy(`/?code=${CODE}&error_code=x`)).headers.get("location")).toBeNull();
  });

  it("doesn't forward malformed, oversized, empty or repeated codes (the homepage just renders)", async () => {
    for (const q of ["code=", "code=abc", `code=${"a".repeat(200)}`, "code=%3Cscript%3E", "code=a%20b%20c%20d%20e", `code=${CODE}&code=${CODE}`, "code=../../etc"]) {
      expect((await runProxy(`/?${q}`)).headers.get("location"), q).toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("can't loop: the forward target isn't handled by the proxy, and plain homepage visits pass through", async () => {
    const { config } = await import("@/proxy");
    const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m.replace(/:path\*/g, ".*")}$`).test(path));
    expect(matches("/auth/callback")).toBe(false);
    expect(matches("/")).toBe(true);
    expect((await runProxy("/")).headers.get("location")).toBeNull();
    expect((await runProxy("/?utm_source=x")).headers.get("location")).toBeNull();
  });
});

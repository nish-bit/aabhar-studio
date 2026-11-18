import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fixes from the development logs:
 * - /dashboard (no such page) redirects to /app/dashboard;
 * - a Supabase outage in the proxy is not "signed out" (no bounce to /login);
 * - an expired session goes to plain /login (no "link expired" message), keeping refreshed cookies;
 * - a reused OAuth callback with a live session continues instead of showing "expired";
 * - safe `next` never points back at the sign-in pages (no loops);
 * - the sign-out form submits once;
 * - the app has no wallet code, so a browser wallet extension failing can't affect it.
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
        if (state.refresh) opts.cookies.setAll([{ name: "sb-test-auth-token", value: "rotated", options: { path: "/", httpOnly: true } }], {});
        return { data: { user: state.user }, error: state.error };
      },
    },
  }),
}));

const ORIGIN = "https://aabhar.example";
const CODE = "8f14e45f-ceea-467f-a8f0-5b2b4b1c7d10";
const run = async (p: string) => (await import("@/proxy")).proxy(new NextRequest(new URL(p, ORIGIN)));
const location = (res: Response) => new URL(res.headers.get("location")!);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  Object.assign(state, { user: null, refresh: false, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("dashboard route", () => {
  it("/dashboard redirects permanently to /app/dashboard (it used to 404)", async () => {
    const res = await run("/dashboard");
    expect(res.status).toBe(308);
    expect(location(res).href).toBe(`${ORIGIN}/app/dashboard`);
  });

  it("/dashboard?code=… still reaches the callback, and OAuth errors still reach /login", async () => {
    const withCode = location(await run(`/dashboard?code=${CODE}`));
    expect(withCode.pathname).toBe("/auth/callback");
    expect(withCode.searchParams.get("next")).toBe("/app/dashboard");
    const withError = location(await run("/dashboard?error=access_denied&error_code=access_denied"));
    expect(withError.pathname).toBe("/login");
    expect(withError.searchParams.get("error")).toBe("cancelled");
  });

  it("the proxy matches /dashboard", async () => {
    expect((await import("@/proxy")).config.matcher).toContain("/dashboard");
  });

  it("every in-app dashboard link points at /app/dashboard", () => {
    // src/proxy.ts is the one place that names /dashboard: to redirect it.
    const offenders = sourceFiles("src")
      .filter((f) => path.relative(ROOT, f) !== path.join("src", "proxy.ts"))
      .filter((f) => /["'`]\/dashboard\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("proxy: outages are not sign-outs", () => {
  for (const error of [{ name: "AuthRetryableFetchError" }, { name: "AuthApiError", status: 429 }, { name: "AuthApiError", status: 503 }]) {
    it(`${error.name} ${error.status ?? ""}: /app is not redirected to /login, and the cookies are kept`, async () => {
      Object.assign(state, { error, user: null });
      const res = await run("/app/dashboard");
      expect(res.headers.get("location")).toBeNull();
      expect(res.cookies.getAll().filter((c) => c.value === "")).toEqual([]);
      // Logged without any token or cookie value.
      const logged = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("auth.proxy_get_user_failed");
      expect(logged).not.toMatch(/sb-|token=|eyJ/);
    });
  }

  it("/login during an outage shows the page (no redirect either way, so no loop)", async () => {
    Object.assign(state, { error: { name: "AuthRetryableFetchError" } });
    expect((await run("/login?next=/app/dashboard")).headers.get("location")).toBeNull();
  });
});

describe("expired sessions and refresh", () => {
  it("an expired or revoked session goes to plain /login with the page kept, never ?error=expired", async () => {
    Object.assign(state, { error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found" } });
    const to = location(await run("/app/history?page=2"));
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBeNull();
    expect(to.searchParams.get("next")).toBe("/app/history?page=2");
  });

  it("a session refreshed during the check is passed on to the page (no redirect)", async () => {
    Object.assign(state, { user: { id: "u1" }, refresh: true });
    const res = await run("/app/dashboard");
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("rotated");
  });
});

describe("no redirect loops", () => {
  it("safe next never points back at /login or /auth/*", async () => {
    const { safeNextPath } = await import("@/lib/safe-redirect");
    for (const bad of ["/login", "/login?next=/login", "/login/", "/auth/callback?code=x", "/auth/sign-out", "/auth"]) {
      expect(safeNextPath(bad), bad).toBe("/app/dashboard");
    }
    expect(safeNextPath("/loginx")).toBe("/loginx");
    expect(safeNextPath("/app/billing?plan=growth")).toBe("/app/billing?plan=growth");
  });

  it("signed in at /login?next=/login: one hop, straight to the dashboard", async () => {
    state.user = { id: "u1" };
    const res = await run(`/login?next=${encodeURIComponent("/login?next=/login")}`);
    expect(location(res).pathname).toBe("/app/dashboard");
  });

  it("signed out on /app goes to /login, and /login itself is not redirected", async () => {
    expect(location(await run("/app/dashboard")).pathname).toBe("/login");
    expect((await run("/login?next=/app/dashboard")).headers.get("location")).toBeNull();
  });
});

describe("OAuth callback with an already-used code", () => {
  const exchangeCodeForSession = vi.fn();
  const getUser = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/server/db/supabase-server", () => ({ supabaseForRequest: async () => ({ auth: { exchangeCodeForSession, getUser } }) }));
    vi.doMock("@/server/db/postgres", () => ({ database: () => null }));
    exchangeCodeForSession.mockReset();
    getUser.mockReset();
  });
  afterEach(() => {
    vi.doUnmock("@/server/db/supabase-server");
    vi.doUnmock("@/server/db/postgres");
  });

  const callback = async (q: string) => {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new Request(`${ORIGIN}/auth/callback?${q}`));
  };
  const used = { data: {}, error: { code: "flow_state_not_found", status: 404, message: "invalid flow state, no valid flow state found" } };

  it("reload after a successful sign-in: continues to the safe destination instead of 'link expired'", async () => {
    exchangeCodeForSession.mockResolvedValue(used);
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await callback(`code=${CODE}&next=${encodeURIComponent("/app/billing?pack=starter")}`);
    expect(res.status).toBe(303);
    expect(location(res).href).toBe(`${ORIGIN}/app/billing?pack=starter`);
    const logged = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("auth.oauth_code_already_used");
    expect(logged).not.toContain(CODE);
  });

  it("an unsafe next still falls back to the dashboard", async () => {
    exchangeCodeForSession.mockResolvedValue(used);
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect(location(await callback(`code=${CODE}&next=${encodeURIComponent("//evil.example")}`)).href).toBe(`${ORIGIN}/app/dashboard`);
  });

  it("no session (other browser, or verifier cookie gone): 'expired' as before", async () => {
    exchangeCodeForSession.mockResolvedValue(used);
    getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    expect(location(await callback(`code=${CODE}`)).searchParams.get("error")).toBe("expired");
    getUser.mockRejectedValue(new Error("network"));
    expect(location(await callback(`code=${CODE}`)).searchParams.get("error")).toBe("expired");
  });

  it("other exchange failures never use an existing session", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "bad_code_verifier", status: 400, message: "invalid" } });
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect(location(await callback(`code=${CODE}`)).searchParams.get("error")).toBe("failed");
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("sign-out form submits once", () => {
  it("accepts the first submit and drops repeats", async () => {
    const { acceptSignOutSubmit } = await import("@/components/auth/sign-out-form");
    const s = { submitting: false };
    expect(acceptSignOutSubmit(s)).toBe(true);
    expect(acceptSignOutSubmit(s)).toBe(false);
    expect(acceptSignOutSubmit(s)).toBe(false);
  });

  it("renders a plain same-site POST form (works without JavaScript)", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SignOutForm } = await import("@/components/auth/sign-out-form");
    const html = renderToStaticMarkup(React.createElement(SignOutForm, null, React.createElement("button", { type: "submit" }, "Sign out")));
    expect(html).toMatch(/<form[^>]*action="\/auth\/sign-out"[^>]*method="post"/);
    expect(html).toContain('<button type="submit">Sign out</button>');
    expect(html).not.toContain("disabled");
  });

  it("every Sign out button uses it", () => {
    for (const f of ["src/app/(app)/app/layout.tsx", "src/app/(app)/app/settings/account/page.tsx"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toContain("<SignOutForm");
      expect(src, f).not.toMatch(/<form[^>]*\/auth\/sign-out/);
    }
  });
});

describe("browser extensions (e.g. MetaMask) are isolated from the app", () => {
  it("the app has no wallet code and never touches window.ethereum", () => {
    const offenders = sourceFiles("src")
      .filter((f) => !f.endsWith(".generated.ts"))
      .filter((f) => /window\.ethereum|\bethereum\b|metamask|wagmi|web3|ethers/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /metamask|wagmi|web3|ethers|viem|walletconnect/i.test(d))).toEqual([]);
  });

  it("no client code installs global error handlers an extension's errors could reach", () => {
    const offenders = sourceFiles("src")
      .filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")))
      .filter((f) => /addEventListener\(\s*["'](error|unhandledrejection)["']|window\.onerror|window\.onunhandledrejection/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

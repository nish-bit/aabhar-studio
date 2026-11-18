import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSignedOutError } from "@/lib/auth-errors";

/**
 * Hardening of the auth fixes:
 * 1. only known missing/expired/revoked-session errors count as signed out; everything else is a
 *    service failure, during which the proxy keeps the browser's session cookies;
 * 2. sign-out recognises every Supabase cookie name (standard, chunked, verifier, hyphenated key);
 * 3. callback recovery only for reused/expired PKCE callbacks, verified with getUser(), safe `next`;
 * 4. /dashboard keeps no query parameters except a well-formed OAuth code (to the callback) or an
 *    OAuth error (to /login with a fixed message).
 */
type Cookie = { name: string; value: string; options: object };
const ssr = vi.hoisted(() => ({
  /** One setAll call. */
  writes: [] as Cookie[],
  /** Several setAll calls, as @supabase/ssr makes one per auth event (used instead of `writes`). */
  batches: [] as Cookie[][],
  user: null as { id: string } | null,
  error: null as { name: string; status?: number; code?: string } | null,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: Cookie[], h?: Record<string, string>) => void } }) => ({
    auth: {
      getUser: async () => {
        const batches = ssr.batches.length ? ssr.batches : ssr.writes.length ? [ssr.writes] : [];
        for (const batch of batches) opts.cookies.setAll(batch, { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" });
        return { data: { user: ssr.user }, error: ssr.error };
      },
    },
  }),
}));

const auth = vi.hoisted(() => ({ signOut: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn() }));
vi.mock("@/server/db/supabase-server", () => ({ supabaseForRequest: async () => ({ auth }) }));
vi.mock("@/server/db/postgres", () => ({ database: () => null }));

const ORIGIN = "https://aabhar.example";
const CODE = "8f14e45f-ceea-467f-a8f0-5b2b4b1c7d10";
const location = (res: Response) => new URL(res.headers.get("location")!);
const del = (name: string): Cookie => ({ name, value: "", options: { path: "/", maxAge: 0 } });
const set = (name: string, value: string): Cookie => ({ name, value, options: { path: "/", httpOnly: true } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  Object.assign(ssr, { writes: [], batches: [], user: null, error: null });
  for (const fn of Object.values(auth)) fn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

// ------------------------------------------------------------------ 1. classification
describe("isSignedOutError", () => {
  const signedOut: [string, object][] = [
    ["missing session (no cookies)", { name: "AuthSessionMissingError", status: 400 }],
    ["expired session", { name: "AuthApiError", status: 403, code: "session_expired" }],
    ["session not found (signed out elsewhere)", { name: "AuthApiError", status: 403, code: "session_not_found" }],
    ["HTTP 400 refresh token not found", { name: "AuthApiError", status: 400, code: "refresh_token_not_found" }],
    ["HTTP 400 refresh token already used", { name: "AuthApiError", status: 400, code: "refresh_token_already_used" }],
    ["HTTP 401 no authorization", { name: "AuthApiError", status: 401, code: "no_authorization" }],
    ["HTTP 403 bad JWT", { name: "AuthApiError", status: 403, code: "bad_jwt" }],
    ["deleted user", { name: "AuthApiError", status: 404, code: "user_not_found" }],
    ["banned user", { name: "AuthApiError", status: 403, code: "user_banned" }],
  ];
  const serviceFailure: [string, object][] = [
    ["HTTP 400 without a session code", { name: "AuthApiError", status: 400, code: "validation_failed" }],
    ["HTTP 400 with no code", { name: "AuthApiError", status: 400 }],
    ["HTTP 401 with no code (e.g. wrong API key)", { name: "AuthApiError", status: 401 }],
    ["HTTP 403 with no code", { name: "AuthApiError", status: 403 }],
    ["HTTP 403 not_admin", { name: "AuthApiError", status: 403, code: "not_admin" }],
    ["HTTP 429 rate limit", { name: "AuthApiError", status: 429, code: "over_request_rate_limit" }],
    ["HTTP 429 even with a session code", { name: "AuthApiError", status: 429, code: "session_not_found" }],
    ["HTTP 500", { name: "AuthApiError", status: 500, code: "unexpected_failure" }],
    ["HTTP 503 with a session code", { name: "AuthRetryableFetchError", status: 503, code: "session_expired" }],
    ["network failure", { name: "AuthRetryableFetchError", status: 0 }],
    ["unknown error", { name: "Error" }],
    ["empty error", {}],
  ];
  for (const [label, err] of signedOut) it(`signed out: ${label}`, () => expect(isSignedOutError(err)).toBe(true));
  for (const [label, err] of serviceFailure) it(`service failure: ${label}`, () => expect(isSignedOutError(err)).toBe(false));
});

describe("proxy keeps the session cookies during service failures", () => {
  const run = async (p: string, cookie: string) =>
    (await import("@/proxy")).proxy(new NextRequest(new URL(p, ORIGIN), { headers: { cookie } }));
  /** Cookies the page will see (Next.js passes the proxy's request changes on in this header). */
  const pageCookies = (res: Response) => res.headers.get("x-middleware-request-cookie");

  it("a refresh failing with 429 clears nothing: no redirect, no deletions, page keeps the original cookies", async () => {
    Object.assign(ssr, { writes: [del("sb-project-auth-token.0"), del("sb-project-auth-token.1")], error: { name: "AuthApiError", status: 429, code: "over_request_rate_limit" } });
    const res = await run("/app/dashboard", "sb-project-auth-token.0=part0; sb-project-auth-token.1=part1");
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.getAll()).toEqual([]);
    expect(pageCookies(res)).toContain("sb-project-auth-token.0=part0");
    expect(pageCookies(res)).toContain("sb-project-auth-token.1=part1");
  });

  it("an unknown error is treated the same way", async () => {
    Object.assign(ssr, { writes: [del("sb-project-auth-token")], error: { name: "Error" } });
    const res = await run("/app/history", "sb-project-auth-token=orig");
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.getAll()).toEqual([]);
  });

  it("a completed rotation is kept whole even if the following check fails (the old token is spent)", async () => {
    Object.assign(ssr, { writes: [set("sb-project-auth-token", "rotated"), del("sb-project-auth-token.1")], error: { name: "AuthRetryableFetchError", status: 503 } });
    const res = await run("/app/dashboard", "sb-project-auth-token.0=a; sb-project-auth-token.1=b");
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-project-auth-token")?.value).toBe("rotated");
    expect(res.cookies.get("sb-project-auth-token.1")?.value).toBe("");
  });

  it("a real sign-out (revoked session) still clears the cookies and goes to /login", async () => {
    Object.assign(ssr, { writes: [del("sb-project-auth-token")], error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found" } });
    const res = await run("/app/dashboard", "sb-project-auth-token=old");
    expect(location(res).pathname).toBe("/login");
    expect(res.cookies.get("sb-project-auth-token")?.value).toBe("");
  });

  it("logs the failure without cookie values", async () => {
    Object.assign(ssr, { error: { name: "AuthApiError", status: 429, code: "over_request_rate_limit" } });
    await run("/app/dashboard", "sb-project-auth-token=secret-value-123");
    const logged = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("auth.proxy_get_user_failed");
    expect(logged).not.toContain("secret-value-123");
  });
});

/**
 * The Set-Cookie headers the browser actually receives, and the Cookie header the page receives
 * (Next.js passes the proxy's request changes on as x-middleware-request-cookie).
 */
describe("proxy response cookies (what the browser and the page get)", () => {
  const run = async (p: string, cookie: string) =>
    (await import("@/proxy")).proxy(new NextRequest(new URL(p, ORIGIN), { headers: { cookie } }));
  const setCookies = (res: Response) => res.headers.getSetCookie();
  const setCookie = (res: Response, name: string) => setCookies(res).find((h) => h.startsWith(`${name}=`));
  const pageCookie = (res: Response) => res.headers.get("x-middleware-request-cookie") ?? "";
  const RATE_LIMIT = { name: "AuthApiError", status: 429, code: "over_request_rate_limit" };

  it("service failure that only cleared cookies: no Set-Cookie at all, page keeps every original value", async () => {
    Object.assign(ssr, {
      batches: [[del("sb-project-auth-token.0"), del("sb-project-auth-token.1")], [del("sb-project-auth-token-code-verifier")]],
      error: RATE_LIMIT,
    });
    const res = await run("/app/dashboard", "sb-project-auth-token.0=part0; sb-project-auth-token.1=part1; theme=dark");
    expect(res.headers.get("location")).toBeNull();
    expect(setCookies(res)).toEqual([]);
    expect(pageCookie(res)).toContain("sb-project-auth-token.0=part0");
    expect(pageCookie(res)).toContain("sb-project-auth-token.1=part1");
    expect(pageCookie(res)).toContain("theme=dark");
    // A cookie Supabase "deleted" that the browser never sent isn't invented for the page.
    expect(pageCookie(res)).not.toContain("code-verifier");
  });

  it("service failure after a successful refresh: the rotated token reaches the browser even when a later batch wrote something else", async () => {
    Object.assign(ssr, {
      batches: [[set("sb-project-auth-token", "rotated"), del("sb-project-auth-token.1")], [set("sb-project-other", "x")]],
      error: { name: "AuthRetryableFetchError", status: 503 },
    });
    const res = await run("/app/dashboard", "sb-project-auth-token.0=old0; sb-project-auth-token.1=old1");
    expect(res.headers.get("location")).toBeNull();
    expect(setCookie(res, "sb-project-auth-token")).toMatch(/^sb-project-auth-token=rotated;.*Path=\/.*HttpOnly/i);
    expect(setCookie(res, "sb-project-auth-token.1")).toMatch(/Max-Age=0/i);
    expect(pageCookie(res)).toContain("sb-project-auth-token=rotated");
  });

  it("refresh then sign-out in one request: the final (signed-out) state is sent, nothing is restored", async () => {
    Object.assign(ssr, {
      batches: [[set("sb-project-auth-token", "rotated")], [del("sb-project-auth-token")]],
      error: { name: "AuthRetryableFetchError", status: 503 },
    });
    const res = await run("/app/dashboard", "sb-project-auth-token=old");
    expect(setCookie(res, "sb-project-auth-token")).toMatch(/^sb-project-auth-token=;.*Max-Age=0/i);
  });

  it("successful refresh, signed in: every batch's cookies are sent (not just the last setAll call)", async () => {
    Object.assign(ssr, {
      batches: [[set("sb-project-auth-token.0", "new0"), set("sb-project-auth-token.1", "new1")], [del("sb-project-auth-token-code-verifier")]],
      user: { id: "u1" },
    });
    const res = await run("/app/dashboard", "sb-project-auth-token=old; sb-project-auth-token-code-verifier=v");
    expect(res.headers.get("location")).toBeNull();
    expect(setCookie(res, "sb-project-auth-token.0")).toMatch(/^sb-project-auth-token\.0=new0;/);
    expect(setCookie(res, "sb-project-auth-token.1")).toMatch(/^sb-project-auth-token\.1=new1;/);
    expect(setCookie(res, "sb-project-auth-token-code-verifier")).toMatch(/Max-Age=0/i);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("successful refresh, signed in at /login: the redirect carries the rotated cookies", async () => {
    Object.assign(ssr, { batches: [[set("sb-project-auth-token", "rotated")]], user: { id: "u1" } });
    const res = await run("/login?next=/app/history", "sb-project-auth-token=old");
    expect(location(res).pathname).toBe("/app/history");
    expect(setCookie(res, "sb-project-auth-token")).toMatch(/^sb-project-auth-token=rotated;/);
  });

  it("genuine sign-out (revoked session): the browser is told to delete every chunk, and is sent to /login", async () => {
    Object.assign(ssr, {
      batches: [[del("sb-project-auth-token.0"), del("sb-project-auth-token.1")]],
      error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found" },
    });
    const res = await run("/app/dashboard", "sb-project-auth-token.0=a; sb-project-auth-token.1=b");
    expect(location(res).pathname).toBe("/login");
    expect(setCookie(res, "sb-project-auth-token.0")).toMatch(/Max-Age=0/i);
    expect(setCookie(res, "sb-project-auth-token.1")).toMatch(/Max-Age=0/i);
  });

  it("genuine sign-out with no session at all on a public API route: deletions still sent, no redirect", async () => {
    Object.assign(ssr, { batches: [[del("sb-project-auth-token")]], error: { name: "AuthSessionMissingError", status: 400 } });
    const res = await run("/api/me", "sb-project-auth-token=garbage");
    expect(res.headers.get("location")).toBeNull();
    expect(setCookie(res, "sb-project-auth-token")).toMatch(/Max-Age=0/i);
  });
});


// ------------------------------------------------------------------ 2. sign-out cookies
describe("sign-out recognises Supabase cookies", () => {
  const post = async (cookie: string | null, origin: string | null = ORIGIN) => {
    const { POST } = await import("@/app/auth/sign-out/route");
    const headers: Record<string, string> = {};
    if (origin) headers.origin = origin;
    if (cookie !== null) headers.cookie = cookie;
    return POST(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST", headers }));
  };

  it("absent: nothing to end, no Supabase call, goes home", async () => {
    for (const cookie of [null, "", "theme=dark", "xsb-ref-auth-token=x", "sb-ref-auth-tokenx=x", "sb--auth-token=x", "sb-ref-auth-token.x=x"]) {
      const res = await post(cookie);
      expect(res.status, String(cookie)).toBe(303);
      expect(location(res).href).toBe(`${ORIGIN}/`);
    }
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  for (const [label, cookie] of [
    ["standard", "sb-eguuncnkcjqmeatrpzcj-auth-token=base64-x"],
    ["chunked", "sb-eguuncnkcjqmeatrpzcj-auth-token.0=base64-a; sb-eguuncnkcjqmeatrpzcj-auth-token.1=b"],
    ["custom-domain key with hyphens", "sb-auth-aabhar-auth-token=base64-x"],
    ["only a PKCE verifier left", "sb-ref-auth-token-code-verifier=v"],
    ["per-flow verifier", "sb-ref-auth-token-flow-AbCdEf123456-code-verifier=v"],
    ["spaces around the name", "theme=dark;  sb-ref-auth-token.0 =x"],
  ] as const) {
    it(`${label}: ends the session with Supabase`, async () => {
      auth.signOut.mockResolvedValue({ error: null });
      expect((await post(cookie)).status).toBe(303);
      expect(auth.signOut).toHaveBeenCalledOnce();
    });
  }

  it("if Supabase fails, clears every Supabase cookie (chunks and verifiers) and nothing else", async () => {
    auth.signOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError" } });
    const res = await post("sb-a-b-auth-token.0=x; sb-a-b-auth-token.1=y; sb-a-b-auth-token-code-verifier=v; theme=dark; other=1");
    const cleared = res.cookies.getAll().filter((c) => c.value === "").map((c) => c.name).sort();
    expect(cleared).toEqual(["sb-a-b-auth-token-code-verifier", "sb-a-b-auth-token.0", "sb-a-b-auth-token.1"]);
  });

  it("keeps CSRF protection: cross-site or Origin-less requests are refused before anything else", async () => {
    expect((await post("sb-ref-auth-token=x", "https://evil.example")).status).toBe(403);
    expect((await post("sb-ref-auth-token=x", null)).status).toBe(403);
    expect((await post(null, "https://evil.example")).status).toBe(403);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ 3. callback recovery
describe("OAuth callback recovery", () => {
  const callback = async (q: string) => {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new Request(`${ORIGIN}/auth/callback?${q}`));
  };
  const failWith = (code: string, message = "error") => auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code, status: 400, message } });
  const signedIn = () => auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

  for (const code of ["flow_state_not_found", "flow_state_expired", "pkce_code_verifier_not_found"]) {
    it(`${code} with a verified session: continues to next, creates no session`, async () => {
      failWith(code);
      signedIn();
      const res = await callback(`code=${CODE}&next=${encodeURIComponent("/app/history?page=2")}`);
      expect(location(res).href).toBe(`${ORIGIN}/app/history?page=2`);
      expect(auth.getUser).toHaveBeenCalledOnce();
      expect(auth.exchangeCodeForSession).toHaveBeenCalledOnce();
      expect(res.cookies.getAll()).toEqual([]);
    });
  }

  it("missing session: login with 'expired'", async () => {
    failWith("flow_state_not_found");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    expect(location(await callback(`code=${CODE}`)).searchParams.get("error")).toBe("expired");
  });

  it("Supabase verification failure (error, throw, or user with an error): no recovery", async () => {
    failWith("flow_state_not_found");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    expect(location(await callback(`code=${CODE}`)).pathname).toBe("/login");
    auth.getUser.mockRejectedValue(new Error("network"));
    expect(location(await callback(`code=${CODE}`)).pathname).toBe("/login");
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: { name: "AuthApiError", status: 500 } });
    expect(location(await callback(`code=${CODE}`)).pathname).toBe("/login");
  });

  it("a PKCE mismatch (bad_code_verifier) or any other error never consults the existing session", async () => {
    signedIn();
    for (const [code, message] of [
      ["bad_code_verifier", "code challenge does not match previously saved code verifier"],
      ["bad_oauth_state", "OAuth state parameter is invalid"],
      ["validation_failed", "invalid request"],
    ]) {
      failWith(code, message);
      const to = location(await callback(`code=${CODE}`));
      expect(to.pathname, code).toBe("/login");
      expect(to.searchParams.get("error"), code).toBe("failed");
    }
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("expiry is decided by the error code, never by message text", async () => {
    signedIn();
    // Message mentions "verifier" / "expired", but the code says otherwise (or there is none).
    for (const error of [
      { code: "bad_code_verifier", status: 400, message: "code challenge does not match previously saved code verifier" },
      { status: 400, message: "both auth code and code verifier should be non-empty" },
      { code: "validation_failed", status: 400, message: "flow state expired" },
      { code: "unexpected_failure", status: 500, message: "PKCE verifier lookup failed" },
    ]) {
      auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error });
      expect(location(await callback(`code=${CODE}`)).searchParams.get("error"), error.message).toBe("failed");
    }
    // Code says expired, message says nothing about it.
    for (const code of ["flow_state_not_found", "flow_state_expired", "pkce_code_verifier_not_found"]) {
      auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
      auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code, status: 400, message: "" } });
      expect(location(await callback(`code=${CODE}`)).searchParams.get("error"), code).toBe("expired");
    }
    expect(auth.getUser).toHaveBeenCalledTimes(3); // only for the expired-flow codes
  });

  it("unsafe next destinations fall back to the dashboard", async () => {
    failWith("flow_state_not_found");
    signedIn();
    for (const next of ["//evil.example", "https://evil.example/app", "/\\evil.example", "javascript:alert(1)", "/login", "/auth/callback?code=x"]) {
      expect(location(await callback(`code=${CODE}&next=${encodeURIComponent(next)}`)).href, next).toBe(`${ORIGIN}/app/dashboard`);
    }
  });
});

// ------------------------------------------------------------------ 4. /dashboard
describe("/dashboard redirect", () => {
  const run = async (p: string) => (await import("@/proxy")).proxy(new NextRequest(new URL(p, ORIGIN)));

  it("goes to /app/dashboard and drops every other query parameter", async () => {
    for (const q of ["", "?next=//evil.example", "?redirect=https://evil.example", "?plan=growth&utm_source=x", "?code=not%20a%20code", `?code=${CODE}&code=${CODE}`]) {
      const res = await run(`/dashboard${q}`);
      expect(res.status, q).toBe(308);
      expect(location(res).href, q).toBe(`${ORIGIN}/app/dashboard`);
    }
  });

  it("a well-formed OAuth code goes to the callback with only `code` and a fixed `next`", async () => {
    const to = location(await run(`/dashboard?code=${CODE}&next=//evil.example&x=1`));
    expect(to.pathname).toBe("/auth/callback");
    expect([...to.searchParams.keys()].sort()).toEqual(["code", "next"]);
    expect(to.searchParams.get("code")).toBe(CODE);
    expect(to.searchParams.get("next")).toBe("/app/dashboard");
  });

  it("an OAuth error with error_code goes to /login with a fixed message, never forwarding the code", async () => {
    const cancelled = location(await run(`/dashboard?error=access_denied&error_code=access_denied&code=${CODE}`));
    expect(cancelled.pathname).toBe("/login");
    expect(cancelled.searchParams.get("error")).toBe("cancelled");
    const expired = location(await run("/dashboard?error=invalid_request&error_code=bad_oauth_state&error_description=%3Cscript%3E"));
    expect(expired.searchParams.get("error")).toBe("expired");
    expect(expired.search).not.toContain("script");
    expect([...expired.searchParams.keys()].sort()).toEqual(["error", "next"]);
  });

  it("error_code alone (no error) is not a code forward: plain dashboard redirect", async () => {
    const res = await run(`/dashboard?error_code=bad_oauth_state&code=${CODE}`);
    expect(res.status).toBe(308);
    expect(location(res).href).toBe(`${ORIGIN}/app/dashboard`);
  });
});

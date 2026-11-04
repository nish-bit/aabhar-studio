import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { billingConfig } from "@/config/billing";
import { loginErrorMessage, loginPathFor, oauthCallbackUrl, signInPurpose } from "@/lib/auth-flow";
import { safeNextPath } from "@/lib/safe-redirect";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));

const ORIGIN = "https://aabhar.example";
const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.in" } }, error: null });
const signedOut = () => getUser.mockResolvedValue({ data: { user: null }, error: null });

async function runProxy(path: string) {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(path, ORIGIN)));
}

/** Follows a /login?next=… redirect the way the login form does after a verified code. */
function afterSignIn(location: string) {
  return safeNextPath(new URL(location).searchParams.get("next"));
}

describe("logged-out purchase keeps the chosen plan through sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("every plan's Get Started button survives the sign-in redirect", async () => {
    signedOut();
    for (const pack of billingConfig.packs) {
      const href = `/app/billing?pack=${pack.id}`;
      const res = await runProxy(href);
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(new URL(location).pathname).toBe("/login");
      expect(afterSignIn(location)).toBe(href);
    }
  });

  it("keeps a credit pack selection too", async () => {
    signedOut();
    const pack = billingConfig.packs[0]!;
    const res = await runProxy(`/app/billing?pack=${pack.id}`);
    expect(afterSignIn(res.headers.get("location")!)).toBe(`/app/billing?pack=${pack.id}`);
  });

  it("turns a Supabase OAuth error at the site root (e.g. expired state) into a login-page message", async () => {
    signedOut();
    const expired = await runProxy("/?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired");
    expect(expired.status).toBe(303);
    const to = new URL(expired.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("expired");
    expect(to.searchParams.get("next")).toBe("/app/dashboard");
    expect(loginErrorMessage("expired")).toMatch(/try again/i);

    const cancelled = await runProxy("/?error=access_denied&error_description=The+user+denied");
    expect(new URL(cancelled.headers.get("location")!).searchParams.get("error")).toBe("cancelled");

    // Ordinary homepage visits pass straight through, without touching the session.
    getUser.mockClear();
    const home = await runProxy("/");
    expect(home.headers.get("location")).toBeNull();
    expect((await runProxy("/?error=just-a-word")).headers.get("location")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors away from the studio, dashboard and admin", async () => {
    signedOut();
    for (const path of ["/app", "/app/studio", "/app/billing", "/admin", "/admin/users"]) {
      const res = await runProxy(path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/login");
    }
  });

  it("lets signed-in users through, and skips the form if they open /login", async () => {
    signedIn();
    expect((await runProxy("/app/billing?plan=growth")).status).toBe(200);
    const res = await runProxy(`/login?next=${encodeURIComponent("/app/billing?plan=growth")}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/app/billing?plan=growth`);
  });

  it("never redirects a signed-in user off-site from /login", async () => {
    signedIn();
    for (const evil of ["//evil.com", "https://evil.com/app", "/\\evil.com"]) {
      const res = await runProxy(`/login?next=${encodeURIComponent(evil)}`);
      expect(new URL(res.headers.get("location")!).origin).toBe(ORIGIN);
    }
  });
});

describe("sign-in helpers", () => {
  it("builds a login path that keeps the query string", () => {
    expect(loginPathFor("/app/billing", "?plan=growth")).toBe(`/login?next=${encodeURIComponent("/app/billing?plan=growth")}`);
    expect(loginPathFor("/app/studio", "")).toBe(`/login?next=${encodeURIComponent("/app/studio")}`);
  });

  it("names only real packs in the sign-in purpose line", () => {
    const pack = billingConfig.packs[0]!;
    expect(signInPurpose(`/app/billing?pack=${pack.id}`)).toContain(pack.name);
    expect(signInPurpose(`/app/billing?pack=${pack.id}`)).toContain("before anything is charged");
    // Subscription plans are no longer sold, so a stale ?plan= link just says billing.
    expect(signInPurpose("/app/billing?plan=growth")).toBe("Sign in to continue to billing.");
    expect(signInPurpose("/app/billing?pack=<script>")).toBe("Sign in to continue to billing.");
    expect(signInPurpose("/app/studio")).toBeNull();
    expect(signInPurpose("//evil.com/app/billing?plan=x")).toBeNull();
  });

  it("shows only fixed login error messages, never reflected text", () => {
    expect(loginErrorMessage("cancelled")).toMatch(/cancelled/);
    expect(loginErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(loginErrorMessage("toString")).toBeNull();
    expect(loginErrorMessage(null)).toBeNull();
  });

  it("builds the Google callback URL on our own origin with a safe next path", () => {
    expect(oauthCallbackUrl("https://aabhar.example", "/app/billing?plan=growth")).toBe(
      `https://aabhar.example/auth/callback?next=${encodeURIComponent("/app/billing?plan=growth")}`,
    );
    expect(oauthCallbackUrl("https://aabhar.example", "//evil.com")).toBe(`https://aabhar.example/auth/callback?next=${encodeURIComponent("/app/dashboard")}`);
  });
});

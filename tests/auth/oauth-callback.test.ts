import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
let supabaseAvailable = true;
vi.mock("@/server/db/supabase-server", () => ({
  supabaseForRequest: async () => (supabaseAvailable ? { auth: { exchangeCodeForSession } } : null),
}));

const ORIGIN = "https://aabhar.example";
const plan = encodeURIComponent("/app/billing?plan=growth");

async function callback(query: string) {
  const { GET } = await import("@/app/auth/callback/route");
  const res = await GET(new Request(`${ORIGIN}/auth/callback?${query}`));
  const location = new URL(res.headers.get("location")!);
  return { status: res.status, location, error: location.searchParams.get("error"), next: location.searchParams.get("next") };
}

beforeEach(() => {
  supabaseAvailable = true;
  exchangeCodeForSession.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Google sign-in callback", () => {
  it("first-time and returning users: swaps the code for a session and returns to the chosen plan", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    const r = await callback(`code=abc123&next=${plan}`);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(r.status).toBe(303);
    expect(r.location.href).toBe(`${ORIGIN}/app/billing?plan=growth`);
  });

  it("defaults to the dashboard when there is no next path", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    expect((await callback("code=abc")).location.pathname).toBe("/app/dashboard");
  });

  it("cancelled on Google's screen: back to login with a friendly message, plan kept", async () => {
    const r = await callback(`error=access_denied&error_description=The+user+denied&next=${plan}`);
    expect(r.location.pathname).toBe("/login");
    expect(r.error).toBe("cancelled");
    expect(r.next).toBe("/app/billing?plan=growth");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("misconfigured provider or other OAuth errors: generic failure, provider text not reflected", async () => {
    const r = await callback("error=server_error&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    expect(r.error).toBe("failed");
    expect(r.location.search).not.toContain("script");
  });

  it("missing code: incomplete-response error", async () => {
    expect((await callback("next=%2Fapp")).error).toBe("callback");
  });

  it("rejected or reused code: failure, no session", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "bad_code_verifier", status: 400, message: "invalid" } });
    expect((await callback("code=used")).error).toBe("failed");
  });

  it("flow started in another browser or expired: tells the user to retry here", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "flow_state_not_found", status: 404, message: "invalid flow state" } });
    expect((await callback("code=x")).error).toBe("expired");
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { status: 400, message: "both auth code and code verifier should be non-empty" } });
    expect((await callback("code=x")).error).toBe("expired");
  });

  it("Supabase not configured: unavailable", async () => {
    supabaseAvailable = false;
    expect((await callback("code=x")).error).toBe("unavailable");
  });

  it("never redirects off-site, whatever next says", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      const r = await callback(`code=x&next=${encodeURIComponent(evil)}`);
      expect(r.location.origin, evil).toBe(ORIGIN);
    }
  });
});

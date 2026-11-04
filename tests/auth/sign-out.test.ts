import { beforeEach, describe, expect, it, vi } from "vitest";

/** Sign out: same-site only, ends the Supabase session, lands on the public homepage. */
const signOut = vi.fn();
vi.mock("@/server/db/supabase-server", () => ({ supabaseForRequest: async () => ({ auth: { signOut } }) }));

const ORIGIN = "https://aabhar.example";
const post = async (headers: Record<string, string>) => {
  const { POST } = await import("@/app/auth/sign-out/route");
  return POST(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST", headers }));
};

beforeEach(() => {
  signOut.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sign out", () => {
  it("ends the session first, then redirects to the homepage", async () => {
    signOut.mockResolvedValue({ error: null });
    const res = await post({ origin: ORIGIN });
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("clears the session cookies itself if Supabase couldn't", async () => {
    signOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: undefined } });
    const res = await post({ origin: ORIGIN, cookie: "sb-abc123-auth-token.0=x; sb-abc123-auth-token.1=y; theme=dark" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    const cleared = res.cookies.getAll().filter((c) => c.value === "").map((c) => c.name).sort();
    expect(cleared).toEqual(["sb-abc123-auth-token.0", "sb-abc123-auth-token.1"]);
  });

  it("refuses cross-site and Origin-less requests, without signing anyone out", async () => {
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});

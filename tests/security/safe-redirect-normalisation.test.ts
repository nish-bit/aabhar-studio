import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

/**
 * safeNextPath never continues to the sign-in pages (/login, /auth/*), however the path is spelled:
 * any letter case, percent-encoded (once or nested), or with encoded dot segments. Malformed
 * encoding falls back safely. Other same-site paths are returned exactly as given.
 */
const FALLBACK = "/app/dashboard";

describe("safeNextPath: sign-in pages in any spelling fall back", () => {
  it.each([
    // letter case
    "/LOGIN",
    "/Login?next=/app",
    "/LOGIN/",
    "/Auth",
    "/Auth/callback",
    "/AUTH/CALLBACK?code=x",
    "/auth/Sign-Out",
    // percent-encoded letters and slashes
    "/%6Cogin",
    "/%6C%6F%67%69%6E",
    "/%4C%4F%47%49%4E",
    "/%61uth/callback",
    "/auth%2Fcallback",
    // nested encoding ("%25" is "%")
    "/%256Cogin",
    "/%25256Cogin",
    // encoded dot segments and backslashes
    "/app/%2e%2e/login",
    "/app/%2E%2E/AUTH/callback",
    "/app%2F..%2Flogin",
    "/app%5C..%5Clogin",
  ])("refuses %j", (v) => {
    expect(safeNextPath(v)).toBe(FALLBACK);
  });

  it.each([
    ["truncated escape", "/app/%E0%A4%A"],
    ["invalid hex", "/app/%ZZ"],
    ["lone percent", "/app/100%"],
    ["invalid UTF-8", "/app/%C3%28"],
    ["encoded control character", "/app/%0Alogin"],
    ["encoded NUL", "/app/%00"],
    ["encoding nested too deep", "/%2525252525"],
  ])("refuses malformed encoding safely: %s", (_label, v) => {
    expect(() => safeNextPath(v)).not.toThrow();
    expect(safeNextPath(v)).toBe(FALLBACK);
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("/LOGIN", "")).toBe("");
    expect(safeNextPath("/%6Cogin", "/app/billing")).toBe("/app/billing");
  });
});

describe("safeNextPath: existing protections are unchanged", () => {
  it.each(["https://evil.example", "//evil.example", "///evil.example", "/\\evil.example", "/\\/evil.example", "javascript:alert(1)", "/\tevil", "evil.example"])(
    "refuses %j",
    (v) => {
      const out = safeNextPath(v);
      expect(out).toBe(FALLBACK);
      expect(new URL(out, "https://aabhar.example").origin).toBe("https://aabhar.example");
    },
  );
});

describe("safeNextPath: legitimate paths keep working, unchanged", () => {
  it.each([
    "/app/dashboard",
    "/app/billing?plan=growth",
    "/app/billing?pack=starter&next=/login",
    "/admin/users?q=a%40b.com#top",
    "/app/history?page=2",
    "/app/catalogues/My%20Catalogue",
    "/app/100%25",
    "/app/caf%C3%A9",
    "/loginx",
    "/login-help",
    "/authors",
    "/app/login",
    "/app/auth/settings",
    // An encoded backslash or slash stays one path segment in the browser and in Next.js routing:
    // same-site, and not /login (existing policy, see redirects.test.ts).
    "/%5Cevil.com",
    "/%2Flogin",
    // "\.." here only cancels the empty segment: this is /app/login, not /login.
    "/app/%5C..%5Clogin",
  ])("keeps %j", (v) => {
    expect(safeNextPath(v)).toBe(v);
  });
});

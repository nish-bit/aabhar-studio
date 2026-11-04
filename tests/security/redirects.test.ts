import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

describe("post-sign-in redirect", () => {
  it.each([
    "/\\evil.com",
    "/\\/evil.com",
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\tevil.com",
    "/\n/evil.com",
    "evil.com",
    "",
  ])("refuses %j", (v) => {
    const out = safeNextPath(v);
    expect(out).toBe("/app/dashboard");
    expect(new URL(out, "https://aabhar.example").origin).toBe("https://aabhar.example");
  });

  it.each([
    ["/app/catalogues", "/app/catalogues"],
    ["/app/billing?plan=growth", "/app/billing?plan=growth"],
    ["/admin/users?q=a%40b.com#top", "/admin/users?q=a%40b.com#top"],
    ["/%5Cevil.com", "/%5Cevil.com"],
  ])("keeps same-site path %j", (v, expected) => {
    expect(safeNextPath(v)).toBe(expected);
  });
});

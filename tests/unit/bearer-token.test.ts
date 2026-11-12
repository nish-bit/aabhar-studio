import { timingSafeEqual } from "node:crypto";

import { describe, expect, it } from "vitest";

import { bearerTokenMatches } from "@/server/http/bearer";

/**
 * bearerTokenMatches: the shared `Authorization: Bearer <secret>` check for the
 * cron routes and the internal generation runner. It compares UTF-8 bytes in
 * constant time, and a wrong header is always `false`, never an exception.
 */

const SECRET = "3f9c2a7d1e8b4c6a0f5d9e2b7a1c4e8f3f9c2a7d1e8b4c6a0f5d9e2b7a1c4e8f"; // like `openssl rand -hex 32`

const req = (authorization?: string) =>
  new Request("https://www.aabharstudio.com/api/cron/expire-jobs", authorization === undefined ? {} : { headers: { authorization } });

describe("bearerTokenMatches", () => {
  it("accepts exactly `Bearer <secret>` (ASCII)", () => {
    expect(bearerTokenMatches(req(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("rejects a missing, empty or incorrect header", () => {
    for (const authorization of [undefined, "", "Bearer", "Bearer ", SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`, `Bearer ${SECRET.slice(0, -1)}0`, `Bearer ${SECRET}0`, `Bearer ${SECRET.slice(1)}`]) {
      expect(bearerTokenMatches(req(authorization), SECRET), String(authorization)).toBe(false);
    }
  });

  it("rejects non-ASCII headers without throwing, including ones with as many characters as the secret", () => {
    // "é" is 1 character but 2 UTF-8 bytes: same character length, different byte length.
    const sameCharLength = `Bearer ${"é".repeat(SECRET.length)}`;
    expect(sameCharLength.length).toBe(`Bearer ${SECRET}`.length);
    for (const authorization of [sameCharLength, `Bearer ${"é".repeat(SECRET.length / 2)}`, `Bearer ${SECRET.slice(0, -1)}é`, `Bearer ${"ÿ".repeat(8)}`]) {
      expect(() => bearerTokenMatches(req(authorization), SECRET), authorization).not.toThrow();
      expect(bearerTokenMatches(req(authorization), SECRET), authorization).toBe(false);
    }
  });

  it("is exactly the case that made the old check throw (character length equal, byte length not)", () => {
    // The old cron check: compare string lengths, then timingSafeEqual on the bytes.
    const header = `Bearer ${"é".repeat(SECRET.length)}`;
    const expected = `Bearer ${SECRET}`;
    expect(header.length === expected.length).toBe(true);
    expect(() => timingSafeEqual(Buffer.from(header), Buffer.from(expected))).toThrow(RangeError);
  });

  it("never matches when the secret isn't configured", () => {
    for (const secret of [undefined, null, ""]) {
      for (const authorization of [undefined, "", "Bearer ", "Bearer undefined", "Bearer null"]) {
        expect(bearerTokenMatches(req(authorization), secret), `${String(secret)} / ${String(authorization)}`).toBe(false);
      }
    }
  });
});

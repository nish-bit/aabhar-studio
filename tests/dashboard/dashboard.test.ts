import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import type { Db } from "@/server/db/sql";
import { GALLERY_PAGE_SIZE, getDashboard, greetingName, listGallery, type DashboardDeps } from "@/server/dashboard/service";
import type { ObjectStorage } from "@/server/generation/ports";

import { createTestDatabase, createUser, insertGeneratedImage } from "../support/pglite-db";

/**
 * Dashboard and gallery data on the real migrations: counts and balance
 * come from the existing tables, only the user's own shop is visible,
 * discarded results are hidden, and the gallery pages correctly.
 */
let pg: PGlite;
let db: Db;
let deps: DashboardDeps;

const storage = { signedUrl: async (_bucket: string, path: string) => `https://signed.example/${path}` } as unknown as ObjectStorage;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  deps = { db, storage };
}, 60_000);

describe("dashboard", () => {
  it("a new user sees their 2 free generations, no images, and an empty recent list", async () => {
    const u = await createUser(pg);
    expect(await getDashboard(deps, u.userId)).toMatchObject({
      balance: 2,
      freeTrial: { total: 2, remaining: 2, expired: false },
      imagesMade: 0,
      recent: [],
    });
  });

  it("counts successful images, shows recent ones newest first, and hides discarded results and other shops", async () => {
    const u = await createUser(pg);
    const other = await createUser(pg);
    await insertGeneratedImage(pg, { ...u, review: "approved" });
    await insertGeneratedImage(pg, { ...u, review: "pending" });
    await insertGeneratedImage(pg, { ...u, review: "discarded" });
    await insertGeneratedImage(pg, { ...other, review: "approved" });

    const d = await getDashboard(deps, u.userId);
    expect(d.imagesMade).toBe(3); // every successful generation counts, even one later discarded
    expect(d.recent).toHaveLength(2);
    expect(d.recent.map((r) => r.reviewStatus).sort()).toEqual(["approved", "pending"]);
    expect(d.recent.every((r) => r.styleName === "White Studio" && r.url.startsWith("https://signed.example/" + u.shopId))).toBe(true);
    expect(new Date(d.recent[0]!.createdAt) >= new Date(d.recent[1]!.createdAt)).toBe(true);
  });

  it("an id with no account at all gets the clear 'shop isn't set up' error, never someone else's shop", async () => {
    await expect(getDashboard(deps, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/shop isn't set up yet/);
  });
});

describe("gallery", () => {
  it("pages through the user's images with a cursor", async () => {
    const u = await createUser(pg);
    for (let i = 0; i < GALLERY_PAGE_SIZE + 2; i++) await insertGeneratedImage(pg, { ...u, review: "approved" });
    await pg.query(
      `update public.generated_images g set created_at = now() - (n * interval '1 minute')
         from (select id, row_number() over (order by id) as n from public.generated_images where shop_id = $1) x
        where g.id = x.id`,
      [u.shopId],
    );
    const first = await listGallery(deps, u.userId, null);
    expect(first.items).toHaveLength(GALLERY_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listGallery(deps, u.userId, first.nextCursor);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((i) => i.generatedImageId));
    expect(ids.size).toBe(GALLERY_PAGE_SIZE + 2);
  });
});

describe("greeting name", () => {
  it("uses the Google first name, then the email, then a neutral fallback", () => {
    expect(greetingName({ name: "Priya Sharma", email: "p@x.in" })).toBe("Priya");
    expect(greetingName({ name: null, email: "rahul.jewellers@gmail.com" })).toBe("Rahul jewellers");
    expect(greetingName({ name: "  ", email: null })).toBe("there");
  });
});

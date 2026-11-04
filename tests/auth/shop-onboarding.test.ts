import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { membershipOrOnboard } from "@/server/auth/ensure-shop";
import { BillingRepository } from "@/server/billing/repository";
import { getBillingOverview, type BillingDeps } from "@/server/billing/service";
import { CatalogueRepository } from "@/server/catalogue/repository";
import { listCatalogues, type CatalogueDeps } from "@/server/catalogue/service";
import { getDashboard } from "@/server/dashboard/service";
import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";
import type { ObjectStorage } from "@/server/generation/ports";

import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * "You don't have access to this" for a signed-in user whose account
 * predates the sign-up trigger (no profile, shop or membership). Every shop
 * lookup now sets up that user's own shop on first use, exactly once, and
 * never touches anyone else's.
 */
let pg: PGlite;
let db: Db;
const storage = { signedUrl: async () => "https://signed.example/x" } as unknown as ObjectStorage;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);
beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));

async function accountWithoutShop() {
  const id = randomUUID();
  await pg.exec("alter table auth.users disable trigger on_auth_user_created");
  await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  await pg.exec("alter table auth.users enable trigger on_auth_user_created");
  return id;
}
const shopsOf = async (userId: string) =>
  (await pg.query<{ shop_id: string; role: string }>("select shop_id, role::text as role from public.shop_members where user_id = $1", [userId])).rows;

const billing = (): BillingDeps => ({ repo: new BillingRepository(db), gateway: null, config: null, availability: { enabled: false, mode: null, keyId: null, reason: "off" } });
const catalogue = (): CatalogueDeps => ({ repo: new CatalogueRepository(db), storage });

describe("signed-in account with no shop", () => {
  it("billing, catalogues and the dashboard all work; exactly one owned shop is created, with the trial", async () => {
    const id = await accountWithoutShop();
    expect(await shopsOf(id)).toEqual([]);

    const [overview, catalogues, dash] = await Promise.all([
      getBillingOverview(billing(), id),
      listCatalogues(catalogue(), id),
      getDashboard({ db, storage }, id),
    ]);
    expect(overview.canManage).toBe(true);
    expect(overview.balance).toBe(2);
    expect(catalogues).toEqual([]);
    expect(dash.balance).toBe(2);

    // Later requests and refreshes reuse it.
    await getBillingOverview(billing(), id);
    await listCatalogues(catalogue(), id);
    const shops = await shopsOf(id);
    expect(shops).toHaveLength(1);
    expect(shops[0]!.role).toBe("owner");
  });

  it("users with a shop are unchanged, and nobody gets linked to another user's shop", async () => {
    const a = await createUser(pg);
    const b = await accountWithoutShop();
    await getBillingOverview(billing(), b);
    expect((await shopsOf(a.userId)).map((s) => s.shop_id)).toEqual([a.shopId]);
    expect((await shopsOf(b)).map((s) => s.shop_id)).not.toContain(a.shopId);
    expect((await getBillingOverview(billing(), a.userId)).balance).toBe(2);
  });

  it("an editor/viewer membership is respected: viewers still can't manage billing", async () => {
    const owner = await createUser(pg);
    const viewer = await accountWithoutShop();
    await pg.query("insert into public.profiles (id) values ($1)", [viewer]);
    await pg.query("insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'viewer')", [owner.shopId, viewer]);
    const o = await getBillingOverview(billing(), viewer);
    expect(o.canManage).toBe(false);
    expect(await shopsOf(viewer)).toHaveLength(1); // no extra shop created for someone who already belongs to one
  });
});

describe("when the shop can't be set up", () => {
  it("shows a clear message instead of 'You don't have access to this'", async () => {
    await expect(membershipOrOnboard(async () => null, async () => false)).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.status === 403 && /shop isn't set up yet/.test(e.message),
    );
    await expect(membershipOrOnboard(async () => null, null)).rejects.toThrow(/shop isn't set up yet/);
  });
});

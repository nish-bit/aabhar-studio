import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Migration 20261103000300: public.ensure_user_shop and the backfill for
 * accounts created before the sign-up trigger existed ("You don't have
 * access to this" on billing, catalogues and uploads).
 */
const MIGRATION = "20261103000300_ensure_user_shop.sql";
const root = path.resolve(import.meta.dirname, "../..");
let pg: PGlite;

const state = async (db: PGlite, userId: string) => {
  const { rows } = await db.query<{ profiles: number; memberships: number; owner: number; trial_grants: number; balance: number | null }>(
    `select (select count(*) from public.profiles where id = $1)::int as profiles,
            (select count(*) from public.shop_members where user_id = $1)::int as memberships,
            (select count(*) from public.shop_members where user_id = $1 and role = 'owner')::int as owner,
            (select count(*) from public.credit_grants g join public.shop_members m on m.shop_id = g.shop_id
              where m.user_id = $1 and g.source = 'trial')::int as trial_grants,
            (select b.balance from public.credit_balances b join public.shop_members m on m.shop_id = b.shop_id where m.user_id = $1) as balance`,
    [userId],
  );
  return rows[0]!;
};

/** An auth user created the way pre-trigger accounts were: no profile, shop or membership. */
async function userWithoutShop(db: PGlite) {
  const id = randomUUID();
  await db.exec("alter table auth.users disable trigger on_auth_user_created");
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  await db.exec("alter table auth.users enable trigger on_auth_user_created");
  return id;
}

beforeAll(async () => {
  ({ pg } = await createTestDatabase());
}, 60_000);

describe("ensure_user_shop", () => {
  it("gives a pre-trigger account its profile, an owned shop and the trial, exactly once", async () => {
    const id = await userWithoutShop(pg);
    expect(await state(pg, id)).toMatchObject({ profiles: 0, memberships: 0 });

    const first = (await pg.query<{ s: string }>("select public.ensure_user_shop($1) as s", [id])).rows[0]!.s;
    const again = (await pg.query<{ s: string }>("select public.ensure_user_shop($1) as s", [id])).rows[0]!.s;
    await Promise.all([1, 2, 3].map(() => pg.query("select public.ensure_user_shop($1)", [id])));

    expect(again).toBe(first);
    expect(await state(pg, id)).toEqual({ profiles: 1, memberships: 1, owner: 1, trial_grants: 1, balance: 2 });
  });

  it("changes nothing for a user who already has a shop", async () => {
    const u = await createUser(pg); // normal sign-up through the trigger
    await pg.query("update public.credit_balances set balance = 42 where shop_id = $1", [u.shopId]);
    const s = (await pg.query<{ s: string }>("select public.ensure_user_shop($1) as s", [u.userId])).rows[0]!.s;
    expect(s).toBe(u.shopId);
    expect(await state(pg, u.userId)).toMatchObject({ memberships: 1, trial_grants: 1, balance: 42 });
  });

  it("refuses unknown users and can't be called by signed-in customers", async () => {
    await expect(pg.query("select public.ensure_user_shop($1)", [randomUUID()])).rejects.toThrow(/user_not_found/);
    const u = await createUser(pg);
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u.userId}', false);`);
    try {
      await expect(pg.query("select public.ensure_user_shop($1)", [u.userId])).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  });
});

describe(`migration ${MIGRATION}`, () => {
  it("backfills accounts that predate the trigger and leaves everyone else unchanged", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(path.join(root, "tests/support/supabase-stubs.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    const files = readdirSync(dir).sort();
    expect(files).toContain(MIGRATION);
    for (const f of files.filter((f) => f < MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));

    const orphan = await userWithoutShop(db);
    const normal = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'n@test.local')", [normal]);
    const before = await state(db, normal);

    await db.exec(readFileSync(path.join(dir, MIGRATION), "utf8"));

    expect(await state(db, orphan)).toMatchObject({ profiles: 1, memberships: 1, owner: 1, trial_grants: 1 });
    expect(await state(db, normal)).toEqual(before);
    // Later migrations (e.g. the 2-generation trial cap) may change balances on purpose.
    for (const f of files.filter((f) => f > MIGRATION)) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    // New sign-ups still get exactly one shop through the rewritten trigger.
    const fresh = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'f@test.local')", [fresh]);
    expect(await state(db, fresh)).toMatchObject({ profiles: 1, memberships: 1, trial_grants: 1, balance: 2 });
    await db.close();
  }, 60_000);
});

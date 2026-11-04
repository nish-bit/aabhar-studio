import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, createUser } from "../support/pglite-db";

let pg: PGlite;
beforeEach(async () => {
  ({ pg } = await createTestDatabase());
}, 60_000);

const count = async (sql: string, args: unknown[]) => Number((await pg.query<{ n: string }>(sql, args)).rows[0]!.n);

describe("accounts created by Google sign-in", () => {
  it("first sign-in creates exactly one profile, one owned shop and one trial grant", async () => {
    const u = await createUser(pg); // Supabase inserts one auth.users row on first Google sign-in
    expect(await count("select count(*) n from public.profiles where id = $1", [u.userId])).toBe(1);
    expect(await count("select count(*) n from public.shop_members where user_id = $1 and role = 'owner'", [u.userId])).toBe(1);
    expect(await count("select count(*) n from public.credit_grants where shop_id = $1 and source = 'trial'", [u.shopId])).toBe(1);
  });

  it("returning sign-ins (Supabase updates the same auth.users row) never duplicate the profile, shop or trial", async () => {
    const u = await createUser(pg);
    const trialBefore = await count("select count(*) n from public.credit_grants where shop_id = $1", [u.shopId]);
    for (let i = 0; i < 3; i++) {
      await pg.query("update auth.users set email = email where id = $1", [u.userId]); // e.g. last_sign_in_at refresh
    }
    expect(await count("select count(*) n from public.profiles where id = $1", [u.userId])).toBe(1);
    expect(await count("select count(*) n from public.shops where created_by = $1", [u.userId])).toBe(1);
    expect(await count("select count(*) n from public.credit_grants where shop_id = $1", [u.shopId])).toBe(trialBefore);
  });

  it("a profile can't be created twice for the same user id", async () => {
    const u = await createUser(pg);
    await expect(pg.query("insert into public.profiles (id) values ($1)", [u.userId])).rejects.toThrow(/duplicate key|unique/);
  });
});

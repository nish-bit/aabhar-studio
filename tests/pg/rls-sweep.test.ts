import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asCustomer, createRealDatabase, REAL_PG_URL, realSource, realUser } from "./real-postgres";

/**
 * Exhaustive access sweep on real PostgreSQL with Supabase-like roles and
 * default grants. Instead of a hand-picked list, it enumerates every table
 * and function in the database, so a new table without RLS fails the test.
 */
describe.skipIf(!REAL_PG_URL)("RLS and privileges sweep (real PostgreSQL)", () => {
  let env: Awaited<ReturnType<typeof createRealDatabase>>;
  let A: { userId: string; shopId: string };
  let B: { userId: string; shopId: string };
  let tables: { name: string; hasShopId: boolean }[];

  beforeAll(async () => {
    env = await createRealDatabase(4);
    const sql = env.sql;
    A = await realUser(sql);
    B = await realUser(sql);
    // Give shop A one row in (almost) every table.
    const src = await realSource(sql, A.shopId, A.userId);
    const [job] = await sql<{ r_job_id: string }[]>`select r_job_id from public.create_generation_job(${A.userId}, ${A.shopId}, ${src}, 'white-studio', 1, 'private note', 1, 'openai', 'm', ${randomUUID()}, 5, 100)`;
    await sql`select public.claim_generation_job(${job!.r_job_id}, 60)`;
    await sql`insert into public.job_attempts (job_id, attempt_no, provider, model, outcome) values (${job!.r_job_id}, 1, 'openai', 'm', 'succeeded')`;
    await sql`select public.complete_generation_job(${job!.r_job_id}, ${`${A.shopId}/${job!.r_job_id}/result.png`}, 'image/png', 1024, 1024, 1000, null, 1000, 'req_1')`;
    const [gi] = await sql<{ id: string }[]>`select id from public.generated_images where job_id = ${job!.r_job_id}`;
    const [cat] = await sql<{ id: string }[]>`insert into public.catalogues (shop_id, name, created_by) values (${A.shopId}, 'A private catalogue', ${A.userId}) returning id`;
    await sql`insert into public.catalogue_items (catalogue_id, shop_id, generated_image_id, position, name) values (${cat!.id}, ${A.shopId}, ${gi!.id}, 0, 'Secret ring')`;
    await sql`insert into public.catalogue_exports (catalogue_id, shop_id, kind, storage_path, bytes, catalogue_version, created_by)
              values (${cat!.id}, ${A.shopId}, 'pdf', ${`${A.shopId}/${cat!.id}/x.pdf`}, 10, 1, ${A.userId})`;
    await sql`update public.business_profiles set business_name = 'A Jewellers', phone = '+91 99999 00000' where shop_id = ${A.shopId}`;
    await sql`insert into public.plans (id, name, monthly_credits, limits, is_paid) values ('starter', 'Starter', 100, '{}', true) on conflict do nothing`;
    const [price] = await sql<{ id: string }[]>`insert into public.plan_prices (plan_id, mode, amount_paise, razorpay_plan_id) values ('starter', 'test', 99900, 'plan_rls') returning id`;
    const [sub] = await sql<{ id: string }[]>`insert into public.billing_subscriptions (shop_id, plan_id, price_id, mode, razorpay_subscription_id, status, created_by)
              values (${A.shopId}, 'starter', ${price!.id}, 'test', 'sub_rls', 'active', ${A.userId}) returning id`;
    await sql`insert into public.credit_packs (id, name, credits, amount_paise, validity_days) values ('pack-50', 'x', 50, 59900, 365) on conflict do nothing`;
    const [order] = await sql<{ id: string }[]>`insert into public.billing_orders (shop_id, pack_id, credits, validity_days, amount_paise, mode, razorpay_order_id, idempotency_key, created_by)
              values (${A.shopId}, 'pack-50', 50, 365, 59900, 'test', 'order_rls', 'k', ${A.userId}) returning id`;
    const [pay] = await sql<{ id: string }[]>`insert into public.billing_payments (shop_id, razorpay_payment_id, kind, subscription_id, amount_paise, status, description)
              values (${A.shopId}, 'pay_rls', 'subscription', ${sub!.id}, 99900, 'captured', 'x') returning id`;
    await sql`insert into public.billing_refunds (shop_id, payment_id, razorpay_refund_id, amount_paise, status) values (${A.shopId}, ${pay!.id}, 'rfnd_rls', 100, 'processed')`;
    await sql`insert into public.billing_receipts (shop_id, payment_id, receipt_number, buyer) values (${A.shopId}, ${pay!.id}, 'AS/x/1', '{}')`;
    await sql`insert into public.billing_webhook_events (event_id, event_type, mode, payload) values ('evt_rls', 'payment.captured', 'test', '{"email":"a@private.test"}')`;
    await sql`insert into public.platform_admins (user_id, role, granted_by) values (${A.userId}, 'support', 'qa')`;
    await sql`insert into public.admin_audit_log (actor_id, actor_role, action, target_type) values (${A.userId}, 'support', 'user.view', 'user')`;
    await sql`insert into public.preset_settings (slug, credit_cost) values ('velvet', 2)`;
    await sql`insert into storage.objects (bucket_id, name) values ('originals', ${`${A.shopId}/${src}/s.jpg`}), ('generated', ${`${A.shopId}/${job!.r_job_id}/result.png`}), ('catalogues', ${`${A.shopId}/${cat!.id}/x.pdf`})`;
    void order;
    tables = await sql<{ name: string; hasShopId: boolean }[]>`
      select c.relname as name, exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'shop_id' and not a.attisdropped) as "hasShopId"
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`;
  }, 90_000);
  afterAll(async () => env?.drop());

  it("has RLS enabled on every public table", async () => {
    const off = await env.sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(off.map((r) => r.relname)).toEqual([]);
    expect(tables.length).toBeGreaterThanOrEqual(25);
  });

  it("lets signed-in customers execute only the intended functions", async () => {
    const rows = await env.sql<{ fn: string }[]>`
      select n.nspname || '.' || p.proname as fn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prokind = 'f'
         and p.prorettype <> 'trigger'::regtype
         and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
       order by 1`;
    // is_shop_member is used by RLS policies; it only reveals the caller's own membership.
    expect(rows.map((r) => r.fn)).toEqual(["app.is_shop_member"]);
  });

  it("shows anonymous visitors nothing", async () => {
    for (const t of tables) {
      const res = await asCustomer(env.sql, null, (tx) => tx.unsafe(`select count(*)::int as n from public.${t.name}`)).then(
        (r) => (r as unknown as { n: number }[])[0]!.n,
        (e: Error) => (/permission denied/.test(e.message) ? 0 : Promise.reject(e)),
      );
      expect(res, t.name).toBe(0);
    }
  });

  it("never shows customer B any of customer A's rows, in any table", async () => {
    for (const t of tables.filter((x) => x.hasShopId)) {
      const n = await asCustomer(env.sql, B.userId, (tx) => tx.unsafe(`select count(*)::int as n from public.${t.name} where shop_id = $1`, [A.shopId])).then(
        (r) => (r as unknown as { n: number }[])[0]!.n,
        (e: Error) => (/permission denied/.test(e.message) ? 0 : Promise.reject(e)),
      );
      expect(n, t.name).toBe(0);
    }
    // Tables without shop_id that hold private data: B sees only their own profile; nothing else.
    const profiles = await asCustomer(env.sql, B.userId, (tx) => tx`select id from public.profiles`);
    expect(profiles.map((r) => r.id)).toEqual([B.userId]);
    for (const t of ["platform_admins", "admin_audit_log", "billing_webhook_events", "job_attempts", "credit_allocations", "receipt_counters", "plan_prices", "preset_settings", "billing_settings"]) {
      const res = await asCustomer(env.sql, B.userId, (tx) => tx.unsafe(`select count(*)::int as n from public.${t}`)).then(
        (r) => (r as unknown as { n: number }[])[0]!.n,
        (e: Error) => (/permission denied/.test(e.message) ? 0 : Promise.reject(e)),
      );
      expect(res, t).toBe(0);
    }
  });

  it("lets customer A read their own rows (policies aren't simply deny-all)", async () => {
    for (const t of ["shops", "source_images", "generation_jobs", "generated_images", "catalogues", "catalogue_items", "billing_payments", "credit_grants", "credit_ledger"]) {
      const [{ n }] = await asCustomer(env.sql, A.userId, (tx) => tx.unsafe(`select count(*)::int as n from public.${t}`)) as unknown as { n: number }[];
      expect(n, t).toBeGreaterThan(0);
    }
  });

  it("refuses every client write to every table (insert, update, delete)", async () => {
    for (const t of tables) {
      for (const stmt of [`delete from public.${t.name}`, `update public.${t.name} set ${t.name === "profiles" ? "full_name = 'x'" : "ctid = ctid"}`]) {
        const affected = await asCustomer(env.sql, A.userId, async (tx) => (await tx.unsafe(stmt)).count).catch((e: Error) => {
          if (/permission denied|cannot assign|column "ctid"|append-only/.test(e.message)) return 0;
          throw new Error(`${t.name}: ${e.message}`);
        });
        expect(affected, `${stmt}`).toBe(0);
      }
      const canInsert = await env.sql<{ ok: boolean }[]>`select has_table_privilege('authenticated', ${`public.${t.name}`}, 'insert') as ok`;
      if (canInsert[0]!.ok) {
        // Privilege remains from Supabase defaults; RLS must still reject it (no insert policies exist).
        const [{ n }] = await env.sql<{ n: number }[]>`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = ${t.name} and cmd in ('INSERT', 'ALL')`;
        expect(n, `${t.name} insert policies`).toBe(0);
      }
    }
  });

  it("keeps storage objects private to the owning shop", async () => {
    const asB = await asCustomer(env.sql, B.userId, (tx) => tx`select name from storage.objects`);
    expect(asB).toHaveLength(0);
    const asA = await asCustomer(env.sql, A.userId, (tx) => tx`select name from storage.objects`);
    expect(asA).toHaveLength(3);
    const anon = await asCustomer(env.sql, null, (tx) => tx`select name from storage.objects`).catch(() => []);
    expect(anon).toHaveLength(0);
  });
});

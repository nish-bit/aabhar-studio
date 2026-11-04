import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { queryAudit } from "@/server/admin/audit";
import { requireAdmin, type AdminContext } from "@/server/admin/guard";
import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";
import { deleteAccountData } from "@/server/privacy/delete-account";
import { runRetention } from "@/server/privacy/retention";
import { MemoryObjectStorage } from "@/server/storage/memory";

import { makeAdmin } from "../support/admin-fixtures";
import { createTestDatabase, createUser, insertGeneratedImage } from "../support/pglite-db";

let pg: PGlite;
let db: Db;
let storage: MemoryObjectStorage;
let admin: AdminContext;

beforeEach(async () => {
  ({ pg, db } = await createTestDatabase());
  storage = new MemoryObjectStorage();
  const a = await makeAdmin(pg, "admin");
  admin = await requireAdmin(db, { id: a.userId, email: a.email }, "write");
}, 60_000);

const bytes = new Uint8Array([1, 2, 3]);
const has = (bucket: string, path: string) => storage.get(bucket, path) !== null;

async function pendingUpload(shopId: string, userId: string, hoursAgo: number) {
  const id = randomUUID();
  const path = `${shopId}/${id}/upload.jpg`;
  await pg.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path, created_at)
     values ($1, $2, $3, 'gps-tagged.jpg', 'image/jpeg', 100, $4, now() - make_interval(hours => $5))`,
    [id, shopId, userId, path, hoursAgo],
  );
  storage.put("originals", path, bytes);
  return { id, path };
}

describe("retention", () => {
  it("deletes abandoned raw uploads, old discarded results, expired exports and previews; keeps recent and approved data", async () => {
    const u = await createUser(pg);
    const oldUpload = await pendingUpload(u.shopId, u.userId, 30);
    const freshUpload = await pendingUpload(u.shopId, u.userId, 1);

    const kept = await insertGeneratedImage(pg, { shopId: u.shopId, userId: u.userId, review: "approved" });
    const discarded = await insertGeneratedImage(pg, { shopId: u.shopId, userId: u.userId, review: "discarded" });
    await pg.query("update public.generated_images set reviewed_at = now() - interval '31 days' where id = $1", [discarded.generatedImageId]);
    storage.put("generated", kept.storagePath, bytes);
    storage.put("generated", discarded.storagePath, bytes);

    const [cat] = (await pg.query<{ id: string }>("insert into public.catalogues (shop_id, name, created_by) values ($1, 'C', $2) returning id", [u.shopId, u.userId])).rows;
    const exp = async (kind: string, age: string) => {
      const path = `${u.shopId}/${cat!.id}/${kind}-${randomUUID()}.pdf`;
      await pg.query(
        `insert into public.catalogue_exports (catalogue_id, shop_id, kind, storage_path, bytes, catalogue_version, created_by, created_at)
         values ($1, $2, $3, $4, 3, 1, $5, now() - $6::interval)`,
        [cat!.id, u.shopId, kind, path, u.userId, age],
      );
      storage.put("catalogues", path, bytes);
      return path;
    };
    const oldPdf = await exp("pdf", "8 days");
    const newPdf = await exp("pdf", "1 day");
    const oldPreview = await exp("preview", "25 hours");

    await pg.query(
      `insert into public.billing_webhook_events (event_id, event_type, mode, payload, processed_at, received_at)
       values ('evt_old', 'payment.captured', 'test', $1::jsonb, now(), now() - interval '31 days')`,
      [JSON.stringify({ payload: { payment: { entity: { id: "pay_1", amount: 100, status: "captured", email: "c@private.test", contact: "+919999999999" } } } })],
    );

    const r = await runRetention({ db, storage });
    expect(r).toMatchObject({ pendingUploads: 1, discardedResults: 1, exports: 2, webhookPayloadsRedacted: 1 });

    expect(has("originals", oldUpload.path)).toBe(false);
    expect(has("originals", freshUpload.path)).toBe(true);
    expect(has("generated", discarded.storagePath)).toBe(false);
    expect(has("generated", kept.storagePath)).toBe(true);
    expect(has("catalogues", oldPdf)).toBe(false);
    expect(has("catalogues", oldPreview)).toBe(false);
    expect(has("catalogues", newPdf)).toBe(true);

    const { rows } = await pg.query<{ payload: unknown }>("select payload from public.billing_webhook_events where event_id = 'evt_old'");
    const text = JSON.stringify(rows[0]!.payload);
    expect(text).not.toContain("c@private.test");
    expect(text).not.toContain("+919999999999");
    expect(text).toContain("pay_1"); // ids and amounts kept for operations
    expect((await runRetention({ db, storage })).webhookPayloadsRedacted).toBe(0); // idempotent
  });

  it("purges catalogues deleted more than 30 days ago, including their export files", async () => {
    const u = await createUser(pg);
    const [cat] = (await pg.query<{ id: string }>("insert into public.catalogues (shop_id, name, created_by, deleted_at) values ($1, 'Old', $2, now() - interval '31 days') returning id", [u.shopId, u.userId])).rows;
    const path = `${u.shopId}/${cat!.id}/x.zip`;
    await pg.query(`insert into public.catalogue_exports (catalogue_id, shop_id, kind, storage_path, bytes, catalogue_version, created_by) values ($1, $2, 'images_zip', $3, 3, 1, $4)`, [cat!.id, u.shopId, path, u.userId]);
    storage.put("catalogues", path, bytes);
    expect((await runRetention({ db, storage })).deletedCatalogues).toBe(1);
    expect(has("catalogues", path)).toBe(false);
    expect((await pg.query("select 1 from public.catalogues where id = $1", [cat!.id])).rows).toHaveLength(0);
  });
});

describe("account data deletion", () => {
  it("dry-runs, then deletes the customer's files and content, keeps financial records, and audits it", async () => {
    const u = await createUser(pg);
    const img = await insertGeneratedImage(pg, { shopId: u.shopId, userId: u.userId });
    storage.put("generated", img.storagePath, bytes);
    const { rows: src } = await pg.query<{ storage_path: string }>("select storage_path from public.source_images where shop_id = $1", [u.shopId]);
    storage.put("originals", src[0]!.storage_path, bytes);
    await pg.query("update public.business_profiles set business_name = 'Private Jewellers', phone = '+91 98765 43210', logo_path = $2 where shop_id = $1", [u.shopId, `${u.shopId}/logo.png`]);
    storage.put("brand-assets", `${u.shopId}/logo.png`, bytes);
    await pg.query("select public.grant_credits($1, 50, 'pack', null, 'pay-key', 'Bought 50 credits')", [u.shopId]);

    const anonymized: string[] = [];
    const deps = { db, storage, authAdmin: { anonymize: async (id: string) => void anonymized.push(id) } };

    const dry = await deleteAccountData(deps, admin, { userId: u.userId, reason: "Request #42 by email", apply: false });
    expect(dry).toMatchObject({ applied: false, files: { originals: 2, generated: 1, "brand-assets": 1 } });
    expect(has("generated", img.storagePath)).toBe(true);

    const done = await deleteAccountData(deps, admin, { userId: u.userId, reason: "Request #42 by email", apply: true });
    expect(done.applied).toBe(true);
    expect(storage.objects.size).toBe(0);
    for (const t of ["source_images", "generated_images", "generation_jobs", "catalogues"]) {
      expect((await pg.query(`select 1 from public.${t} where shop_id = $1`, [u.shopId])).rows, t).toHaveLength(0);
    }
    const { rows: bp } = await pg.query<{ business_name: string; phone: string }>("select business_name, phone from public.business_profiles where shop_id = $1", [u.shopId]);
    expect(bp[0]).toEqual({ business_name: "", phone: "" });
    const { rows: ledger } = await pg.query("select 1 from public.credit_ledger where shop_id = $1", [u.shopId]);
    expect(ledger.length).toBeGreaterThan(0); // financial history kept
    const { rows: prof } = await pg.query<{ disabled: boolean }>("select disabled_at is not null as disabled from public.profiles where id = $1", [u.userId]);
    expect(prof[0]!.disabled).toBe(true);
    expect(anonymized).toEqual([u.userId]);
    expect((await queryAudit(db, { targetId: u.userId, action: "user.delete_data" })).items[0]).toMatchObject({ reason: "Request #42 by email" });
  });

  it("refuses while a subscription is live, or when the shop has other members", async () => {
    const u = await createUser(pg);
    await pg.query("insert into public.plans (id, name, monthly_credits, limits, is_paid) values ('starter', 'S', 1, '{}', true) on conflict do nothing");
    const [price] = (await pg.query<{ id: string }>("insert into public.plan_prices (plan_id, mode, amount_paise, razorpay_plan_id) values ('starter', 'test', 1, $1) returning id", [`plan_${randomUUID()}`])).rows;
    await pg.query(`insert into public.billing_subscriptions (shop_id, plan_id, price_id, mode, razorpay_subscription_id, status, created_by) values ($1, 'starter', $2, 'test', $3, 'active', $4)`, [u.shopId, price!.id, `sub_${randomUUID()}`, u.userId]);
    await expect(deleteAccountData({ db, storage }, admin, { userId: u.userId, reason: "request #1", apply: true })).rejects.toSatisfy((e: unknown) => e instanceof DomainError && /subscription/.test(e.message));

    const v = await createUser(pg);
    const other = await createUser(pg);
    await pg.query("insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'editor')", [v.shopId, other.userId]);
    await expect(deleteAccountData({ db, storage }, admin, { userId: v.userId, reason: "request #2", apply: true })).rejects.toSatisfy((e: unknown) => e instanceof DomainError && /shares a shop/.test(e.message));
  });
});

describe("rate limiter", () => {
  it("allows the limit within a window, then refuses", async () => {
    const key = `test:${randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push((await pg.query<{ ok: boolean }>("select public.consume_rate_limit($1, 3, 3600) as ok", [key])).rows[0]!.ok);
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("can't be called by signed-in customers directly", async () => {
    const u = await createUser(pg);
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u.userId}', false);`);
    try {
      await expect(pg.query("select public.consume_rate_limit('x', 1, 60)")).rejects.toThrow(/permission denied/);
      await expect(pg.query("delete from public.rate_limit_counters")).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  });
});

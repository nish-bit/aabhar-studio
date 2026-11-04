import { writeAudit } from "@/server/admin/audit";
import { assertWrite, type AdminContext } from "@/server/admin/guard";
import type { Db } from "@/server/db/sql";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { BUCKETS, type Bucket, type ObjectStorage } from "@/server/generation/ports";

/**
 * Deletes a customer's content at their request (run by an admin via
 * scripts/delete-account.ts, after verifying the request).
 *
 * Deleted: every photo, result, catalogue, export and logo (files and rows),
 * prompt notes, business profile details, the shop name, marketing email
 * consent records, support tickets, refund-request explanations, and the
 * sign-in email (replaced with a placeholder and banned).
 *
 * Kept, for accounting and fraud prevention: payments, receipts,
 * subscriptions, the credit ledger and webhook events (payloads are
 * redacted by the retention job after 30 days), and the admin audit log.
 */
export interface DeleteAccountDeps {
  db: Db;
  storage: ObjectStorage;
  authAdmin?: { anonymize(userId: string): Promise<void> } | null;
}

export interface DeletionPlan {
  userId: string;
  shopId: string;
  files: Record<Bucket, number>;
  rows: { sourceImages: number; generatedImages: number; jobs: number; catalogues: number };
}

const LIVE = ["authenticated", "active", "pending", "halted", "paused"];

async function plan(db: Db, userId: string) {
  const m = await db.query<{ shopId: string; role: string; others: number }>(
    `select m.shop_id as "shopId", m.role::text as role,
            (select count(*)::int from public.shop_members o where o.shop_id = m.shop_id and o.user_id <> m.user_id) as others
       from public.shop_members m where m.user_id = $1 order by m.created_at limit 1`,
    [userId],
  );
  const mem = m[0];
  if (!mem) throw domainErrors.notFound("User");
  if (mem.role !== "owner" || mem.others > 0) {
    throw new DomainError("invalid_request", "This user shares a shop with others. Remove them from the shop, or transfer ownership, first.", 400);
  }
  const live = await db.query(
    `select 1 from public.billing_subscriptions where shop_id = $1 and status = any(string_to_array($2, ',')) and not cancel_at_cycle_end`,
    [mem.shopId, LIVE.join(",")],
  );
  if (live.length) throw new DomainError("invalid_request", "Cancel this shop's subscription first, so it isn't charged again.", 400);

  const q = (sql: string) => db.query<{ p: string | null }>(sql, [mem.shopId]).then((r) => r.map((x) => x.p));
  const files: Record<Bucket, (string | null)[]> = {
    originals: [
      ...(await q(`select storage_path as p from public.source_images where shop_id = $1`)),
      ...(await q(`select upload_path as p from public.source_images where shop_id = $1`)),
    ],
    generated: await q(`select storage_path as p from public.generated_images where shop_id = $1`),
    catalogues: await q(`select storage_path as p from public.catalogue_exports where shop_id = $1`),
    "brand-assets": await q(`select logo_path as p from public.business_profiles where shop_id = $1`),
  };
  const counts = await db.query<DeletionPlan["rows"]>(
    `select (select count(*)::int from public.source_images where shop_id = $1) as "sourceImages",
            (select count(*)::int from public.generated_images where shop_id = $1) as "generatedImages",
            (select count(*)::int from public.generation_jobs where shop_id = $1) as jobs,
            (select count(*)::int from public.catalogues where shop_id = $1) as catalogues`,
    [mem.shopId],
  );
  return { shopId: mem.shopId, files, rows: counts[0]! };
}

export async function deleteAccountData(
  deps: DeleteAccountDeps,
  ctx: AdminContext,
  input: { userId: string; reason: string; apply: boolean },
): Promise<DeletionPlan & { applied: boolean }> {
  assertWrite(ctx);
  if (input.reason.trim().length < 5) throw new DomainError("invalid_request", "Give a reason (e.g. the request reference).", 400);
  if (input.userId === ctx.userId) throw new DomainError("invalid_request", "You can't delete your own account this way.", 400);
  const p = await plan(deps.db, input.userId);
  const summary: DeletionPlan = {
    userId: input.userId,
    shopId: p.shopId,
    files: Object.fromEntries(Object.entries(p.files).map(([b, list]) => [b, list.filter(Boolean).length])) as Record<Bucket, number>,
    rows: p.rows,
  };
  if (!input.apply) return { ...summary, applied: false };

  // Files first: if storage fails, nothing in the database has changed and the run can be repeated.
  for (const bucket of Object.values(BUCKETS)) {
    const list = p.files[bucket].filter((x): x is string => Boolean(x));
    for (let i = 0; i < list.length; i += 100) await deps.storage.remove(bucket, list.slice(i, i + 100));
  }

  await deps.db.transaction(async (tx) => {
    await tx.query(`delete from public.catalogues where shop_id = $1`, [p.shopId]);
    await tx.query(`delete from public.generated_images where shop_id = $1`, [p.shopId]);
    await tx.query(`delete from public.generation_jobs where shop_id = $1`, [p.shopId]);
    await tx.query(`delete from public.source_images where shop_id = $1`, [p.shopId]);
    await tx.query(
      `update public.business_profiles set business_name = '', logo_path = null, logo_mime_type = null, phone = '', whatsapp = '',
              email = '', website = '', address = '', updated_at = now() where shop_id = $1`,
      [p.shopId],
    );
    await tx.query(`update public.shops set name = 'Deleted shop' where id = $1`, [p.shopId]);
    // Marketing consent and its history go too; the email is being removed, so nobody could be mailed anyway.
    await tx.query(`delete from public.marketing_consent_events where user_id = $1`, [input.userId]);
    await tx.query(`delete from public.marketing_subscriptions where user_id = $1`, [input.userId]);
    // Free text the customer wrote: tickets go; refund requests keep their credit record but lose the explanation.
    await tx.query(`delete from public.support_tickets where user_id = $1`, [input.userId]);
    await tx.query(`update public.refund_requests set reason = '[Removed at the user''s request]' where user_id = $1`, [input.userId]);
    await tx.query(
      `update public.profiles set full_name = null, disabled_at = coalesce(disabled_at, now()),
              disabled_reason = 'Account data deleted at the user''s request', disabled_by = $2 where id = $1`,
      [input.userId, ctx.userId],
    );
    await writeAudit(tx, ctx, { action: "user.delete_data", targetType: "user", targetId: input.userId, reason: input.reason, details: summary as unknown as Record<string, unknown> });
  });

  // Replace the sign-in email and block sign-in (best effort; the account is already disabled in the database).
  if (deps.authAdmin) {
    try {
      await deps.authAdmin.anonymize(input.userId);
    } catch (err) {
      await writeAudit(deps.db, ctx, { action: "user.auth_ban_failed", targetType: "user", targetId: input.userId, reason: null, details: { error: String(err).slice(0, 200) } });
    }
  }
  return { ...summary, applied: true };
}

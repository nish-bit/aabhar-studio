import type { Db } from "@/server/db/sql";
import { BUCKETS, type Bucket, type ObjectStorage } from "@/server/generation/ports";

/**
 * Data retention. Runs daily from /api/cron/retention. Every step deletes
 * storage objects first and database rows second, so a storage failure
 * leaves the row in place to be retried next run (no orphaned files).
 *
 * Kept (not touched here): approved results and their originals, active
 * catalogues, and financial records (payments, receipts, subscriptions,
 * credit ledger), which must be retained for accounting.
 */
export const RETENTION = {
  /** Unfinished uploads: the raw file still has its original metadata (GPS, camera). */
  pendingUploadHours: 24,
  rejectedUploadDays: 7,
  discardedResultDays: 30,
  exportDays: 7,
  previewHours: 24,
  deletedCatalogueDays: 30,
  /** Raw webhook payloads contain customer email/phone; ids and amounts are kept. */
  webhookPayloadDays: 30,
  rateLimitCounterHours: 24,
} as const;

const BATCH = 500;

export interface RetentionResult {
  pendingUploads: number;
  rejectedUploads: number;
  discardedResults: number;
  exports: number;
  deletedCatalogues: number;
  webhookPayloadsRedacted: number;
  rateLimitCounters: number;
}

async function removeObjects(storage: ObjectStorage, bucket: Bucket, paths: (string | null)[]) {
  const list = paths.filter((p): p is string => Boolean(p));
  for (let i = 0; i < list.length; i += 100) await storage.remove(bucket, list.slice(i, i + 100));
}

export async function runRetention(deps: { db: Db; storage: ObjectStorage }): Promise<RetentionResult> {
  const { db, storage } = deps;
  const r = RETENTION;

  // 1. Uploads that were never completed: delete the raw file and the row.
  const pending = await db.query<{ id: string; upload_path: string }>(
    `select id, upload_path from public.source_images
      where status = 'pending' and created_at < now() - make_interval(hours => $1) limit ${BATCH}`,
    [r.pendingUploadHours],
  );
  await removeObjects(storage, BUCKETS.originals, pending.map((p) => p.upload_path));
  if (pending.length) await db.query(`delete from public.source_images where id = any(string_to_array($1, ',')::uuid[])`, [pending.map((p) => p.id).join(",")]);

  // 2. Rejected uploads (raw file already removed at rejection; remove again to be sure).
  const rejected = await db.query<{ id: string; upload_path: string }>(
    `select id, upload_path from public.source_images
      where status = 'rejected' and created_at < now() - make_interval(days => $1) limit ${BATCH}`,
    [r.rejectedUploadDays],
  );
  await removeObjects(storage, BUCKETS.originals, rejected.map((p) => p.upload_path));
  if (rejected.length) await db.query(`delete from public.source_images where id = any(string_to_array($1, ',')::uuid[])`, [rejected.map((p) => p.id).join(",")]);

  // 3. Results the customer discarded.
  const discarded = await db.query<{ id: string; storage_path: string }>(
    `select id, storage_path from public.generated_images
      where review_status = 'discarded' and reviewed_at < now() - make_interval(days => $1) limit ${BATCH}`,
    [r.discardedResultDays],
  );
  await removeObjects(storage, BUCKETS.generated, discarded.map((d) => d.storage_path));
  if (discarded.length) await db.query(`delete from public.generated_images where id = any(string_to_array($1, ',')::uuid[])`, [discarded.map((d) => d.id).join(",")]);

  // 4. Export files (download links are short-lived; customers can re-export any time) and previews.
  const exports = await db.query<{ id: string; storage_path: string }>(
    `select id, storage_path from public.catalogue_exports
      where (kind = 'preview' and created_at < now() - make_interval(hours => $1))
         or (kind <> 'preview' and created_at < now() - make_interval(days => $2))
      limit ${BATCH}`,
    [r.previewHours, r.exportDays],
  );
  await removeObjects(storage, BUCKETS.catalogues, exports.map((e) => e.storage_path));
  if (exports.length) await db.query(`delete from public.catalogue_exports where id = any(string_to_array($1, ',')::uuid[])`, [exports.map((e) => e.id).join(",")]);

  // 5. Catalogues the customer deleted (they can restore them for 30 days).
  const cats = await db.query<{ id: string }>(
    `select id from public.catalogues where deleted_at < now() - make_interval(days => $1) limit ${BATCH}`,
    [r.deletedCatalogueDays],
  );
  if (cats.length) {
    const ids = cats.map((c) => c.id).join(",");
    const files = await db.query<{ storage_path: string }>(
      `select storage_path from public.catalogue_exports where catalogue_id = any(string_to_array($1, ',')::uuid[])`,
      [ids],
    );
    await removeObjects(storage, BUCKETS.catalogues, files.map((f) => f.storage_path));
    await db.query(`delete from public.catalogues where id = any(string_to_array($1, ',')::uuid[])`, [ids]);
  }

  // 6. Redact old webhook payloads to the fields operations needs.
  const redacted = await db.query<{ id: string }>(
    `update public.billing_webhook_events set payload = jsonb_strip_nulls(jsonb_build_object(
        'redacted', true,
        'payload', jsonb_build_object(
          'payment', jsonb_build_object('entity', jsonb_build_object(
             'id', payload #> '{payload,payment,entity,id}', 'amount', payload #> '{payload,payment,entity,amount}',
             'status', payload #> '{payload,payment,entity,status}', 'order_id', payload #> '{payload,payment,entity,order_id}')),
          'subscription', jsonb_build_object('entity', jsonb_build_object(
             'id', payload #> '{payload,subscription,entity,id}', 'status', payload #> '{payload,subscription,entity,status}',
             'plan_id', payload #> '{payload,subscription,entity,plan_id}')),
          'refund', jsonb_build_object('entity', jsonb_build_object(
             'id', payload #> '{payload,refund,entity,id}', 'amount', payload #> '{payload,refund,entity,amount}',
             'status', payload #> '{payload,refund,entity,status}', 'payment_id', payload #> '{payload,refund,entity,payment_id}')))))
      where received_at < now() - make_interval(days => $1) and processed_at is not null and not (payload ? 'redacted')
      returning id`,
    [r.webhookPayloadDays],
  );

  const counters = await db.query<{ n: number }>(
    `with d as (delete from public.rate_limit_counters where window_start < now() - make_interval(hours => $1) returning 1)
     select count(*)::int as n from d`,
    [r.rateLimitCounterHours],
  );

  return {
    pendingUploads: pending.length,
    rejectedUploads: rejected.length,
    discardedResults: discarded.length,
    exports: exports.length,
    deletedCatalogues: cats.length,
    webhookPayloadsRedacted: redacted.length,
    rateLimitCounters: counters[0]?.n ?? 0,
  };
}

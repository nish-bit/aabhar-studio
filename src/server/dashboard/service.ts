import { z } from "zod";

import { ensureUserShop, membershipOrOnboard } from "@/server/auth/ensure-shop";
import type { FreeTrialView } from "@/lib/billing-types";
import { BillingRepository, iso } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";
import { BUCKETS, type ObjectStorage } from "@/server/generation/ports";
import { PRESETS, type PresetSlug } from "@/lib/presets";

/**
 * Dashboard and gallery data for the signed-in user's own shop. Reads only:
 * the balance comes from credit_balances (the existing ledger keeps it), and
 * image counts and lists from generation_jobs and generated_images. Every
 * query is scoped to the shop the user belongs to, so nobody can see another
 * shop's images. Image links are short-lived signed URLs.
 */
export interface DashboardDeps {
  db: Db;
  storage: ObjectStorage;
}

export interface GalleryItem {
  generatedImageId: string;
  jobId: string;
  url: string;
  presetSlug: PresetSlug;
  styleName: string;
  createdAt: string;
  reviewStatus: "pending" | "approved";
}

export interface DashboardData {
  balance: number;
  freeTrial: FreeTrialView | null;
  /** Successful generations, ever (kept even after a discarded result's file is deleted). */
  imagesMade: number;
  recent: GalleryItem[];
}

/** Signed thumbnail links last long enough to browse the page. */
const URL_TTL_SECONDS = 600;
export const GALLERY_PAGE_SIZE = 24;

export const galleryCursorSchema = z.iso.datetime({ offset: true });

/** The user's shop, setting up their own if it's missing (see src/server/auth/ensure-shop.ts). */
async function shopOf(db: Db, userId: string): Promise<string> {
  const lookup = async () =>
    (await db.query<{ shopId: string }>(`select shop_id as "shopId" from public.shop_members where user_id = $1 order by created_at limit 1`, [userId]))[0]?.shopId ??
    null;
  return membershipOrOnboard(lookup, () => ensureUserShop(db, userId));
}

async function images(deps: DashboardDeps, shopId: string, limit: number, beforeIso: string | null): Promise<GalleryItem[]> {
  const rows = await deps.db.query<{
    generatedImageId: string;
    jobId: string;
    storagePath: string;
    presetSlug: string;
    createdAt: Date | string;
    reviewStatus: "pending" | "approved";
  }>(
    `select g.id as "generatedImageId", g.job_id as "jobId", g.storage_path as "storagePath", j.preset_slug as "presetSlug",
            g.created_at as "createdAt", g.review_status::text as "reviewStatus"
       from public.generated_images g
       join public.generation_jobs j on j.id = g.job_id
      where g.shop_id = $1 and g.review_status <> 'discarded'
        and ($2::timestamptz is null or g.created_at < $2::timestamptz)
      order by g.created_at desc, g.id desc
      limit $3`,
    [shopId, beforeIso, limit],
  );
  return Promise.all(
    rows.map(async (r) => ({
      generatedImageId: r.generatedImageId,
      jobId: r.jobId,
      url: await deps.storage.signedUrl(BUCKETS.generated, r.storagePath, URL_TTL_SECONDS),
      presetSlug: r.presetSlug as PresetSlug,
      styleName: PRESETS[r.presetSlug as PresetSlug]?.name ?? r.presetSlug,
      createdAt: iso(r.createdAt)!,
      reviewStatus: r.reviewStatus,
    })),
  );
}

export async function getDashboard(deps: DashboardDeps, userId: string, recentLimit = 6): Promise<DashboardData> {
  const shopId = await shopOf(deps.db, userId);
  const [counts, recent, freeTrial] = await Promise.all([
    deps.db.query<{ balance: number; imagesMade: number }>(
      `select coalesce((select balance from public.credit_balances where shop_id = $1), 0)::int as balance,
              (select count(*) from public.generation_jobs where shop_id = $1 and status = 'succeeded')::int as "imagesMade"`,
      [shopId],
    ),
    images(deps, shopId, recentLimit, null),
    new BillingRepository(deps.db).freeTrial(shopId),
  ]);
  return { balance: counts[0]?.balance ?? 0, freeTrial, imagesMade: counts[0]?.imagesMade ?? 0, recent };
}

/** One page of the gallery, newest first. `nextCursor` is set when there may be more. */
export async function listGallery(
  deps: DashboardDeps,
  userId: string,
  before: string | null,
): Promise<{ items: GalleryItem[]; nextCursor: string | null }> {
  const shopId = await shopOf(deps.db, userId);
  const items = await images(deps, shopId, GALLERY_PAGE_SIZE, before);
  return { items, nextCursor: items.length === GALLERY_PAGE_SIZE ? items[items.length - 1]!.createdAt : null };
}

/** "Priya Sharma" → "Priya"; falls back to the email's name part, then "there". */
export function greetingName(user: { name?: string | null; email: string | null }): string {
  const first = user.name?.trim().split(/\s+/)[0];
  if (first) return first;
  const local = user.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

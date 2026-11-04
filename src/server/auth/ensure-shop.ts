import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";

/**
 * Every account owns a shop: the sign-up trigger creates it, and the
 * sign-in callback repairs accounts the trigger never saw. This covers the
 * remaining case, an account that's already signed in: when the verified
 * user's shop lookup comes back empty, run the same idempotent database
 * function (public.ensure_user_shop) for that user only, then look again.
 *
 * It never links anyone to another user's shop, and it can't create a
 * second shop (the function returns the existing one, under a lock).
 */
export async function ensureUserShop(db: Db, userId: string): Promise<boolean> {
  try {
    await db.query("select public.ensure_user_shop($1::uuid)", [userId]);
    return true;
  } catch (err) {
    // Usually: migration 20261103000300 not applied yet. Logged without personal data.
    console.error(JSON.stringify({ event: "auth.ensure_shop_failed", userId, error: String(err).slice(0, 200) }));
    return false;
  }
}

export const shopNotReady = () =>
  new DomainError(
    "forbidden",
    "Your shop isn't set up yet, so this can't load. Please reload the page; if it keeps happening, sign out, sign in again, or contact support.",
    403,
  );

/** The user's membership, setting up their own shop first if it's missing. */
export async function membershipOrOnboard<M>(lookup: () => Promise<M | null>, onboard: (() => Promise<boolean>) | null | undefined): Promise<M> {
  const m = await lookup();
  if (m) return m;
  if (onboard && (await onboard())) {
    const again = await lookup();
    if (again) return again;
  }
  throw shopNotReady();
}

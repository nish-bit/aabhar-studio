import { billingConfig, packById } from "@/config/billing";
import type { BillingRepository } from "@/server/billing/repository";

/**
 * Referral rewards, applied by the billing service.
 *
 * rewardReferral runs inside the transaction that grants a captured pack
 * payment. If the buyer was invited, this is their first referral-qualifying
 * purchase (Solo or larger) and the referral is still pending, both sides
 * get their credits and the referral is marked rewarded. Grants are keyed
 * by referral id, and the row is locked, so retries, duplicate webhooks and
 * concurrent verifies can't reward twice.
 */
const DAY_MS = 86_400_000;

export async function rewardReferral(
  repo: BillingRepository,
  p: { shopId: string; packId: string; paymentId: string; now: Date },
): Promise<"rewarded" | "not_eligible"> {
  if (!packById(p.packId)?.referralQualifying) return "not_eligible";
  const rows = await repo.db.query<{ id: string; referrerShopId: string | null }>(
    `select r.id,
            (select m.shop_id from public.shop_members m where m.user_id = r.referrer_user_id order by m.created_at limit 1) as "referrerShopId"
       from public.referrals r
       join public.shop_members b on b.user_id = r.referee_user_id and b.shop_id = $1 and b.role = 'owner'
      where r.status = 'pending'
      for update of r`,
    [p.shopId],
  );
  const referral = rows[0];
  if (!referral?.referrerShopId || referral.referrerShopId === p.shopId) return "not_eligible";

  const { referrerCredits, refereeCredits, validityDays } = billingConfig.referral;
  const expires = new Date(p.now.getTime() + validityDays * DAY_MS);
  const referrerGrant = await repo.grantCredits({
    shopId: referral.referrerShopId, amount: referrerCredits, source: "referral", expiresAt: expires,
    key: `referral:referrer:${referral.id}`, reason: "Referral reward: a jeweller you invited bought a plan",
  });
  const refereeGrant = await repo.grantCredits({
    shopId: p.shopId, amount: refereeCredits, source: "referral", expiresAt: expires,
    key: `referral:referee:${referral.id}`, reason: "Referral bonus for joining through an invite",
  });
  await repo.db.query(
    `update public.referrals set status = 'rewarded', qualifying_payment_id = $2, rewarded_at = $3,
            referrer_grant_id = coalesce($4, referrer_grant_id), referee_grant_id = coalesce($5, referee_grant_id)
      where id = $1`,
    [referral.id, p.paymentId, p.now, referrerGrant, refereeGrant],
  );
  return "rewarded";
}

/** Takes the referral credits back when the payment that earned them is fully refunded. */
export async function reverseReferral(repo: BillingRepository, paymentId: string, refundKey: string): Promise<boolean> {
  const rows = await repo.db.query<{ id: string; referrerGrantId: string | null; refereeGrantId: string | null }>(
    `select id, referrer_grant_id as "referrerGrantId", referee_grant_id as "refereeGrantId"
       from public.referrals where qualifying_payment_id = $1 and status = 'rewarded' for update`,
    [paymentId],
  );
  const r = rows[0];
  if (!r) return false;
  const { referrerCredits, refereeCredits } = billingConfig.referral;
  if (r.referrerGrantId) await repo.reverseGrant(r.referrerGrantId, referrerCredits, `${refundKey}:referrer`, "Referral reward reversed: payment refunded");
  if (r.refereeGrantId) await repo.reverseGrant(r.refereeGrantId, refereeCredits, `${refundKey}:referee`, "Referral bonus reversed: payment refunded");
  await repo.db.query(`update public.referrals set status = 'reversed' where id = $1`, [r.id]);
  return true;
}

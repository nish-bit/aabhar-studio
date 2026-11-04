import { randomInt } from "node:crypto";

import { billingConfig } from "@/config/billing";
import type { ReferralSummary } from "@/lib/support-types";
import type { Db } from "@/server/db/sql";

/**
 * Referral codes and invites. Codes are 8 characters from an alphabet
 * without look-alikes (no I, O, 0 or 1). A person can be referred once, only
 * as a brand-new account, and never by themselves; rewards are granted by
 * ./rewards.ts when they buy a qualifying plan.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_COOKIE = "aabhar_ref";
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The user's code, created on first use (retries on the rare collision). */
export async function ensureReferralCode(db: Db, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db.query<{ code: string }>(
      `insert into public.referral_codes (user_id, code) values ($1, $2)
       on conflict (user_id) do update set code = public.referral_codes.code
       returning code`,
      [userId, newCode()],
    ).catch((err: unknown) => {
      if (/referral_codes_code_key|duplicate key/i.test(String(err))) return null;
      throw err;
    });
    if (rows?.[0]) return rows[0].code;
  }
  throw new Error("Couldn't create a referral code");
}


export async function getReferralSummary(db: Db, userId: string): Promise<ReferralSummary> {
  const code = await ensureReferralCode(db, userId);
  const rows = await db.query<{ invited: number; rewarded: number }>(
    `select count(*)::int as invited, count(*) filter (where status = 'rewarded')::int as rewarded
       from public.referrals where referrer_user_id = $1`,
    [userId],
  );
  const { referrerCredits, refereeCredits } = billingConfig.referral;
  const rewarded = rows[0]?.rewarded ?? 0;
  return { code, invited: rows[0]?.invited ?? 0, rewarded, creditsEarned: rewarded * referrerCredits, referrerCredits, refereeCredits };
}

/**
 * Records that a brand-new account arrived through an invite. Ignores
 * unknown codes, self-referral and anyone already referred. Returns whether
 * a referral was recorded.
 */
export async function recordReferral(db: Db, refereeUserId: string, code: string): Promise<boolean> {
  if (!REFERRAL_CODE_RE.test(code)) return false;
  const rows = await db.query<{ id: string }>(
    `insert into public.referrals (referrer_user_id, referee_user_id)
     select c.user_id, $1 from public.referral_codes c
      where c.code = $2 and c.user_id <> $1
     on conflict (referee_user_id) do nothing
     returning id`,
    [refereeUserId, code],
  );
  return rows.length > 0;
}

import { z } from "zod";

import { MARKETING_CONSENT, type MarketingPreferences, type MarketingStatus } from "@/lib/marketing";
import { iso } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";

/**
 * Marketing consent. Opting in only ever happens on an explicit action by
 * the signed-in user (the sign-up checkbox or the settings switch).
 * Opting out works from settings or from the unsubscribe link without
 * signing in. Every real change appends a consent event in the same
 * transaction; repeating the current state changes nothing.
 */

/**
 * Postgres "undefined_table" (42P01): migration 20261101000200_marketing.sql
 * hasn't been applied to this database yet. Pages show a notice instead of failing.
 */
export const isMarketingSchemaMissing = (err: unknown) => (err as { code?: unknown } | null)?.code === "42P01";

export type OptInSource = "signup" | "sign_in" | "settings";
export type OptOutSource = "settings" | "unsubscribe_link" | "one_click" | "admin";

interface SubRow {
  status: Exclude<MarketingStatus, "none">;
}

export async function getPreferences(db: Db, userId: string): Promise<MarketingPreferences> {
  const rows = await db.query<{ email: string | null; status: MarketingStatus | null; consentAt: Date | string | null; unsubscribedAt: Date | string | null }>(
    `select u.email, s.status, s.consent_at as "consentAt", s.unsubscribed_at as "unsubscribedAt"
       from public.profiles p
       left join auth.users u on u.id = p.id
       left join public.marketing_subscriptions s on s.user_id = p.id
      where p.id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    email: r?.email ?? null,
    status: r?.status ?? "none",
    consentAt: iso(r?.consentAt ?? null),
    unsubscribedAt: iso(r?.unsubscribedAt ?? null),
  };
}

/** Records an explicit opt-in. Returns true if the status changed. */
export async function subscribe(db: Db, userId: string, source: OptInSource): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await tx.query<SubRow>(`select status from public.marketing_subscriptions where user_id = $1 for update`, [userId]);
    if (current[0]?.status === "subscribed") return false;
    await tx.query(
      `insert into public.marketing_subscriptions (user_id, status, consent_at, consent_source, consent_version)
       values ($1, 'subscribed', now(), $2, $3)
       on conflict (user_id) do update
          set status = 'subscribed', consent_at = now(), consent_source = excluded.consent_source,
              consent_version = excluded.consent_version, unsubscribed_at = null, unsubscribe_source = null,
              -- A fresh, explicit opt-in lifts an earlier bounce/complaint suppression.
              suppressed_at = null, suppression_reason = null, updated_at = now()`,
      [userId, source, MARKETING_CONSENT.version],
    );
    await tx.query(
      `insert into public.marketing_consent_events (user_id, action, source, consent_version) values ($1, 'subscribed', $2, $3)`,
      [userId, source, MARKETING_CONSENT.version],
    );
    return true;
  });
}

/** Records an opt-out. Returns true if the status changed. Never creates a record for someone who never opted in. */
export async function unsubscribe(db: Db, userId: string, source: OptOutSource): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await tx.query<SubRow>(`select status from public.marketing_subscriptions where user_id = $1 for update`, [userId]);
    if (!current[0] || current[0].status === "unsubscribed") return false;
    await tx.query(
      `update public.marketing_subscriptions
          set status = 'unsubscribed', unsubscribed_at = now(), unsubscribe_source = $2, updated_at = now()
        where user_id = $1`,
      [userId, source],
    );
    await tx.query(`insert into public.marketing_consent_events (user_id, action, source) values ($1, 'unsubscribed', $2)`, [userId, source]);
    return true;
  });
}

/** Unsubscribe tokens are 64 lowercase hex characters; anything else is rejected without a database lookup. */
export const unsubscribeTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The no-login unsubscribe. Returns false for an unknown token. Unsubscribing
 * twice is fine and still returns true. The account itself is untouched.
 */
export async function unsubscribeByToken(db: Db, token: string, source: "unsubscribe_link" | "one_click"): Promise<boolean> {
  const parsed = unsubscribeTokenSchema.safeParse(token);
  if (!parsed.success) return false;
  const rows = await db.query<{ userId: string }>(`select user_id as "userId" from public.marketing_subscriptions where unsubscribe_token = $1`, [parsed.data]);
  if (!rows[0]) return false;
  await unsubscribe(db, rows[0].userId, source);
  return true;
}

/** For the email provider's bounce/complaint webhook (once one is connected). */
export async function suppress(db: Db, userId: string, reason: "bounce" | "complaint"): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query(
      `update public.marketing_subscriptions set suppressed_at = now(), suppression_reason = $2, updated_at = now()
        where user_id = $1 and suppressed_at is null returning id`,
      [userId, reason],
    );
    if (rows.length) await tx.query(`insert into public.marketing_consent_events (user_id, action, source) values ($1, 'suppressed', 'provider')`, [userId]);
  });
}

/**
 * The only people who may receive marketing email: actively subscribed,
 * not suppressed, account not disabled or deleted, with a valid address.
 * Every export and every future campaign must start from this list.
 */
export interface EligibleRecipient {
  userId: string;
  email: string;
  signedUpAt: string;
  consentAt: string;
  consentSource: OptInSource;
  unsubscribeToken: string;
}

const emailSchema = z.email();

export async function eligibleRecipients(db: Db): Promise<EligibleRecipient[]> {
  const rows = await db.query<Omit<EligibleRecipient, "signedUpAt" | "consentAt"> & { signedUpAt: Date | string; consentAt: Date | string }>(
    `select s.user_id as "userId", u.email, p.created_at as "signedUpAt", s.consent_at as "consentAt",
            s.consent_source as "consentSource", s.unsubscribe_token as "unsubscribeToken"
       from public.marketing_subscriptions s
       join public.profiles p on p.id = s.user_id
       join auth.users u on u.id = s.user_id
      where s.status = 'subscribed' and s.suppressed_at is null and p.disabled_at is null and u.email is not null
      order by s.consent_at, s.user_id`,
  );
  return rows
    .filter((r) => emailSchema.safeParse(r.email).success)
    .map((r) => ({ ...r, signedUpAt: iso(r.signedUpAt)!, consentAt: iso(r.consentAt)! }));
}

import { z } from "zod";

import type { AdminMarketingSummary, AdminSubscriberRow, Page } from "@/lib/admin-types";
import { iso } from "@/server/billing/repository";
import { eligibleRecipients } from "@/server/marketing/consent";

import { writeAudit } from "./audit";
import type { AdminDeps } from "./deps-types";
import { assertWrite, type AdminContext } from "./guard";
import { likeEscape, pageOf, Where, type PageInput } from "./pagination";

/**
 * Marketing subscribers for the admin dashboard. Reading the list needs an
 * admin role (support or admin); exporting email addresses needs the
 * admin role and is written to the audit log.
 */

export async function marketingSummary(deps: AdminDeps, _ctx: AdminContext): Promise<AdminMarketingSummary> {
  const rows = await deps.db.query<AdminMarketingSummary>(
    `select (select count(*)::int from public.profiles) as "registeredUsers",
            count(*) filter (where s.status = 'subscribed')::int as subscribed,
            count(*) filter (where s.status = 'unsubscribed')::int as unsubscribed,
            count(*) filter (where s.status = 'pending')::int as pending,
            ((select count(*)::int from public.profiles) - count(*)::int) as "notOptedIn",
            count(*) filter (where s.status = 'subscribed' and s.suppressed_at is null and p.disabled_at is null)::int as eligible
       from public.marketing_subscriptions s join public.profiles p on p.id = s.user_id`,
  );
  return rows[0]!;
}

const BASE = `
  with base as (
    select p.id as user_id, u.email, p.created_at as signed_up_at, coalesce(s.status, 'none') as status,
           s.consent_at, s.consent_source, s.unsubscribed_at, s.suppression_reason, p.disabled_at is not null as disabled
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join public.marketing_subscriptions s on s.user_id = p.id
  )`;

const COLS = `user_id as "userId", email, signed_up_at as "signedUpAt", status, consent_at as "consentAt", consent_source as "consentSource",
  unsubscribed_at as "unsubscribedAt", suppression_reason as "suppressionReason", disabled`;

export const subscriberFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["subscribed", "unsubscribed", "pending", "none"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type SubscriberFilter = z.infer<typeof subscriberFilterSchema> & PageInput;

export async function listSubscribers(deps: AdminDeps, _ctx: AdminContext, f: SubscriberFilter): Promise<Page<AdminSubscriberRow>> {
  const w = new Where();
  if (f.q?.trim()) w.add("email ilike ?", likeEscape(f.q));
  if (f.status) w.add("status = ?", f.status);
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminSubscriberRow>(
      `${BASE} select ${COLS} from base ${w.sql} order by coalesce(consent_at, signed_up_at) desc, user_id limit ${limit} offset ${offset}`,
      w.params,
    ),
    deps.db.query<{ n: number }>(`${BASE} select count(*)::int as n from base ${w.sql}`, w.params),
  ]);
  return {
    items: rows.map((r) => ({ ...r, signedUpAt: iso(r.signedUpAt)!, consentAt: iso(r.consentAt), unsubscribedAt: iso(r.unsubscribedAt) })),
    page,
    pageSize,
    total: count[0]?.n ?? 0,
  };
}

/** A CSV cell: quoted, and with spreadsheet formula characters neutralised. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Eligible subscribers only (active consent, not suppressed, account active),
 * as CSV. Admin role only; every export is audited with its row count.
 */
export async function exportEligibleSubscribersCsv(deps: AdminDeps, ctx: AdminContext): Promise<{ csv: string; count: number }> {
  assertWrite(ctx);
  const rows = await eligibleRecipients(deps.db);
  const lines = [
    ["email", "signed_up_at", "consent_at", "consent_source"].join(","),
    ...rows.map((r) => [r.email, r.signedUpAt, r.consentAt, r.consentSource].map(csvCell).join(",")),
  ];
  await writeAudit(deps.db, ctx, { action: "marketing.export", targetType: "marketing", targetId: null, reason: null, details: { rows: rows.length } });
  return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
}

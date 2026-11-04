import { z } from "zod";

import type { AdminUserDetail, AdminUserRow, Page } from "@/lib/admin-types";
import { computeEntitlement } from "@/server/billing/entitlements";
import { loadPlanOverrides } from "@/server/billing/plan-overrides";
import { BillingRepository, iso } from "@/server/billing/repository";
import { DomainError, domainErrors } from "@/server/generation/domain-error";

import { queryAudit, writeAudit } from "./audit";
import type { AdminDeps } from "./deps-types";
import { assertWrite, type AdminContext } from "./guard";
import { listJobs } from "./jobs";
import { listLedger, listPayments } from "./billing";
import { isUuid, likeEscape, pageOf, Where, type PageInput } from "./pagination";

/* ------------------------------------------------------------------ list */

const USER_BASE = `
  with base as (
    select p.id, u.email, p.created_at, p.disabled_at,
           m.shop_id, s.name as shop_name, m.role::text as role,
           coalesce(cb.balance, 0) as balance,
           sub.plan_id, sub.status as sub_status,
           (select count(*)::int from public.generation_jobs j where j.requested_by = p.id and j.created_at > now() - interval '30 days') as jobs30d,
           a.role as admin_role
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join lateral (select shop_id, role from public.shop_members where user_id = p.id order by created_at limit 1) m on true
      left join public.shops s on s.id = m.shop_id
      left join public.credit_balances cb on cb.shop_id = m.shop_id
      left join lateral (select plan_id, status from public.billing_subscriptions
                          where shop_id = m.shop_id and status <> 'created' order by created_at desc limit 1) sub on true
      left join public.platform_admins a on a.user_id = p.id and a.revoked_at is null
  )`;

const USER_COLS = `id, email, created_at as "createdAt", disabled_at as "disabledAt", shop_id as "shopId", shop_name as "shopName",
  role, balance, plan_id as "planId", sub_status as "subscriptionStatus", jobs30d as "jobs30d", admin_role as "adminRole"`;

export const userFilterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["all", "active", "disabled", "admin", "subscribed"]).optional().nullable(),
  plan: z.string().trim().max(40).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});
export type UserFilter = z.infer<typeof userFilterSchema> & PageInput;

const normUser = (r: AdminUserRow): AdminUserRow => ({ ...r, createdAt: iso(r.createdAt)!, disabledAt: iso(r.disabledAt) });

export async function listUsers(deps: AdminDeps, _ctx: AdminContext, f: UserFilter): Promise<Page<AdminUserRow>> {
  const w = new Where();
  const q = f.q?.trim();
  if (q) {
    if (isUuid(q)) w.add("(id = ?::uuid or shop_id = ?::uuid)", q, q);
    else w.add("(email ilike ? or shop_name ilike ?)", likeEscape(q), likeEscape(q));
  }
  if (f.status === "active") w.add("disabled_at is null");
  if (f.status === "disabled") w.add("disabled_at is not null");
  if (f.status === "admin") w.add("admin_role is not null");
  if (f.status === "subscribed") w.add("sub_status in ('active', 'authenticated', 'pending')");
  if (f.plan) w.add("plan_id = ?", f.plan);
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    deps.db.query<AdminUserRow>(`${USER_BASE} select ${USER_COLS} from base ${w.sql} order by created_at desc, id limit ${limit} offset ${offset}`, w.params),
    deps.db.query<{ n: number }>(`${USER_BASE} select count(*)::int as n from base ${w.sql}`, w.params),
  ]);
  return { items: rows.map(normUser), page, pageSize, total: count[0]?.n ?? 0 };
}

/* ---------------------------------------------------------------- detail */

export async function getUserDetail(deps: AdminDeps, ctx: AdminContext, userId: string): Promise<AdminUserDetail> {
  if (!isUuid(userId)) throw domainErrors.notFound("User");
  const rows = await deps.db.query<AdminUserRow & { disabledReason: string | null; disabledByEmail: string | null }>(
    `${USER_BASE}, detail as (
       select base.*, pr.disabled_reason, du.email as disabled_by_email
         from base join public.profiles pr on pr.id = base.id left join auth.users du on du.id = pr.disabled_by
        where base.id = $1)
     select ${USER_COLS}, disabled_reason as "disabledReason", disabled_by_email as "disabledByEmail" from detail`,
    [userId],
  );
  const base = rows[0];
  if (!base) throw domainErrors.notFound("User");
  const user = normUser(base);
  const shopId = user.shopId;
  const billing = new BillingRepository(deps.db);

  const [cat, uploads, jobs, recentJobs, recentPayments, recentLedger, grants, audit, entitlement] = await Promise.all([
    shopId
      ? deps.db.query<{ active: number; deleted: number; items: number; exports: number; lastUpdatedAt: unknown }>(
          `select count(*) filter (where deleted_at is null)::int as active, count(*) filter (where deleted_at is not null)::int as deleted,
                  (select count(*)::int from public.catalogue_items i join public.catalogues c2 on c2.id = i.catalogue_id where c2.shop_id = $1) as items,
                  (select count(*)::int from public.catalogue_exports e where e.shop_id = $1 and e.kind <> 'preview') as exports,
                  max(updated_at) as "lastUpdatedAt"
             from public.catalogues where shop_id = $1`,
          [shopId],
        )
      : Promise.resolve([]),
    shopId
      ? deps.db.query<{ total: number; rejected: number }>(
          `select count(*)::int as total, count(*) filter (where status = 'rejected')::int as rejected from public.source_images where shop_id = $1`,
          [shopId],
        )
      : Promise.resolve([]),
    shopId
      ? deps.db.query<{ total: number; succeeded: number; failed: number; cost: number }>(
          `select count(*)::int as total, count(*) filter (where status = 'succeeded')::int as succeeded,
                  count(*) filter (where status = 'failed')::int as failed, coalesce(sum(cost_usd_micros), 0)::float8 as cost
             from public.generation_jobs where shop_id = $1`,
          [shopId],
        )
      : Promise.resolve([]),
    shopId ? listJobs(deps, ctx, { shopId, pageSize: 10 }) : null,
    shopId ? listPayments(deps, ctx, { shopId, pageSize: 10 }) : null,
    shopId ? listLedger(deps, ctx, { shopId, pageSize: 15 }) : null,
    shopId ? billing.activeGrants(shopId) : Promise.resolve([]),
    queryAudit(deps.db, { targetIds: [userId, ...(shopId ? [shopId] : [])], excludeActions: ["user.view"], pageSize: 20 }),
    shopId
      ? Promise.all([billing.currentSubscription(shopId), loadPlanOverrides(deps.db)]).then(([s, o]) => computeEntitlement(s, new Date(), o))
      : null,
  ]);

  // Viewing a customer's account details is itself recorded.
  await writeAudit(deps.db, ctx, { action: "user.view", targetType: "user", targetId: userId, reason: null });

  const c = cat[0];
  return {
    ...user,
    disabledReason: base.disabledReason,
    disabledByEmail: base.disabledByEmail,
    entitlementState: entitlement?.state ?? "none",
    catalogues: { active: c?.active ?? 0, deleted: c?.deleted ?? 0, items: c?.items ?? 0, exports: c?.exports ?? 0, lastUpdatedAt: iso(c?.lastUpdatedAt) },
    uploads: { total: uploads[0]?.total ?? 0, rejected: uploads[0]?.rejected ?? 0 },
    jobs: { total: jobs[0]?.total ?? 0, succeeded: jobs[0]?.succeeded ?? 0, failed: jobs[0]?.failed ?? 0, costUsdMicros: Number(jobs[0]?.cost ?? 0) },
    recentJobs: recentJobs?.items ?? [],
    recentPayments: recentPayments?.items ?? [],
    recentLedger: recentLedger?.items ?? [],
    grants: grants.map((g) => ({ id: g.id, source: g.source, amount: g.amount, remaining: g.remaining, expiresAt: g.expiresAt })),
    audit: audit.items,
  };
}

/* ------------------------------------------------------- account status */

export const reasonSchema = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500);

export async function setUserDisabled(
  deps: AdminDeps,
  ctx: AdminContext,
  input: { userId: string; disabled: boolean; reason: string },
): Promise<{ userId: string; disabled: boolean; authBan: "applied" | "failed" | "skipped" }> {
  assertWrite(ctx);
  const reason = reasonSchema.parse(input.reason);
  if (!isUuid(input.userId)) throw domainErrors.notFound("User");
  if (input.userId === ctx.userId) throw new DomainError("invalid_request", "You can't disable your own account.", 400);

  await deps.db.transaction(async (tx) => {
    const target = await tx.query<{ disabled: boolean; isAdmin: boolean }>(
      `select p.disabled_at is not null as disabled,
              exists (select 1 from public.platform_admins a where a.user_id = p.id and a.revoked_at is null) as "isAdmin"
         from public.profiles p where p.id = $1 for update`,
      [input.userId],
    );
    const t = target[0];
    if (!t) throw domainErrors.notFound("User");
    if (input.disabled && t.isAdmin) {
      throw new DomainError("invalid_request", "Revoke this person's admin role first (scripts/admin-role.ts).", 400);
    }
    if (t.disabled === input.disabled) {
      throw new DomainError("conflict", input.disabled ? "This account is already disabled." : "This account isn't disabled.", 409);
    }
    await tx.query(
      input.disabled
        ? `update public.profiles set disabled_at = now(), disabled_reason = $2, disabled_by = $3 where id = $1`
        : `update public.profiles set disabled_at = null, disabled_reason = null, disabled_by = null where id = $1`,
      input.disabled ? [input.userId, reason, ctx.userId] : [input.userId],
    );
    await writeAudit(tx, ctx, { action: input.disabled ? "user.disable" : "user.enable", targetType: "user", targetId: input.userId, reason });
  });

  // Also block sign-in at the auth provider. The database flag is enforced either way.
  let authBan: "applied" | "failed" | "skipped" = "skipped";
  if (deps.authAdmin) {
    try {
      await deps.authAdmin.setBanned(input.userId, input.disabled);
      authBan = "applied";
    } catch (err) {
      authBan = "failed";
      await writeAudit(deps.db, ctx, {
        action: "user.auth_ban_failed",
        targetType: "user",
        targetId: input.userId,
        reason: null,
        details: { disabled: input.disabled, error: String(err).slice(0, 200) },
      });
    }
  }
  return { userId: input.userId, disabled: input.disabled, authBan };
}

/* ------------------------------------------------------ promotional grants */

export const promoGrantSchema = z.object({
  shopId: z.uuid(),
  amount: z.number().int().min(1).max(10_000),
  expiresInDays: z.number().int().min(1).max(3650).nullable(),
  reason: reasonSchema,
  idempotencyKey: z.uuid(),
});

export async function grantPromoCredits(deps: AdminDeps, ctx: AdminContext, raw: z.input<typeof promoGrantSchema>) {
  assertWrite(ctx);
  const input = promoGrantSchema.parse(raw);
  const now = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const shop = await tx.query(`select 1 from public.shops where id = $1`, [input.shopId]);
    if (!shop.length) throw domainErrors.notFound("Shop");
    const billing = new BillingRepository(tx);
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null;
    const grantId = await billing.grantCredits({
      shopId: input.shopId,
      amount: input.amount,
      source: "admin",
      expiresAt,
      key: `grant:admin:${input.idempotencyKey}`,
      // Customer-facing ledger text; the internal reason stays in the audit log.
      reason: "Promotional credits",
    });
    if (grantId) {
      await writeAudit(tx, ctx, {
        action: "credits.promo_grant",
        targetType: "shop",
        targetId: input.shopId,
        reason: input.reason,
        details: { amount: input.amount, expiresAt: expiresAt?.toISOString() ?? null, grantId },
      });
    }
    return { granted: grantId !== null, grantId, balance: await billing.balance(input.shopId) };
  });
}

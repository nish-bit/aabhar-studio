import { z } from "zod";

import { billingConfig, planById, type PlanLimits } from "@/config/billing";
import type { AdminConfigView, AdminPlanView, AdminPresetView } from "@/lib/admin-types";
import { PRESET_SLUGS, PRESETS } from "@/lib/presets";
import { planLimitsSchema, planMonthlyCreditsSchema, trialTermsSchema } from "@/server/billing/plan-overrides";
import { iso } from "@/server/billing/repository";
import { DomainError, domainErrors } from "@/server/generation/domain-error";
import { loadPresetSettings } from "@/server/presets/settings";

import { writeAudit } from "./audit";
import type { AdminDeps } from "./deps-types";
import { assertWrite, type AdminContext } from "./guard";
import { reasonSchema } from "./users";

/**
 * Plans, trial and presets. Admins can change limits, monthly credits,
 * the trial allowance and preset availability/cost. Prices are NOT editable
 * here: they're Razorpay Plans, changed through src/config/billing.ts and
 * `npm run billing:sync` after approval.
 */

// The same rules validate admin writes here and overrides read back for public pricing.
export const planUpdateSchema = z.object({
  planId: z.string().min(1).max(40),
  monthlyCredits: planMonthlyCreditsSchema,
  limits: planLimitsSchema,
  reason: reasonSchema,
});

export const trialUpdateSchema = trialTermsSchema.extend({ reason: reasonSchema });

export const presetUpdateSchema = z.object({
  slug: z.enum(PRESET_SLUGS),
  enabled: z.boolean(),
  creditCost: z.number().int().min(1).max(10),
  reason: reasonSchema,
});

/* ------------------------------------------------------------------ read */

export async function getAdminConfig(deps: AdminDeps, _ctx: AdminContext): Promise<AdminConfigView> {
  const [planRows, prices, subs, trial, presetSettings, presetStats] = await Promise.all([
    deps.db.query<{ id: string; monthlyCredits: number; limits: unknown; overriddenAt: unknown }>(
      `select id, monthly_credits as "monthlyCredits", limits, overridden_at as "overriddenAt" from public.plans`,
    ),
    deps.db.query<{ planId: string; mode: "test" | "live"; amountPaise: number; razorpayPlanId: string; active: boolean }>(
      `select plan_id as "planId", mode, amount_paise::int as "amountPaise", razorpay_plan_id as "razorpayPlanId", active
         from public.plan_prices order by created_at desc`,
    ),
    deps.db.query<{ planId: string; n: number }>(
      `select plan_id as "planId", count(*)::int as n from public.billing_subscriptions
        where status in ('authenticated', 'active', 'pending') group by plan_id`,
    ),
    deps.db.query<{ credits: number; validityDays: number }>(
      `select trial_credits as credits, trial_validity_days as "validityDays" from public.billing_settings where id`,
    ),
    loadPresetSettings(deps.db),
    deps.db.query<{ slug: string; total: number; failed: number }>(
      `select preset_slug as slug, count(*)::int as total, count(*) filter (where status = 'failed')::int as failed
         from public.generation_jobs where created_at > now() - interval '30 days' group by preset_slug`,
    ),
  ]);

  const plans: AdminPlanView[] = billingConfig.plans.map((p) => {
    const row = planRows.find((r) => r.id === p.id);
    const overridden = Boolean(row?.overriddenAt);
    const limits = overridden ? ((typeof row!.limits === "string" ? JSON.parse(row!.limits) : row!.limits) as PlanLimits) : p.limits;
    return {
      id: p.id,
      name: p.name,
      isPaid: p.monthlyPricePaise !== null,
      monthlyCredits: overridden ? row!.monthlyCredits : p.monthlyCredits,
      limits: { ...limits, presets: limits.presets === "all" ? "all" : [...limits.presets] },
      overridden,
      overriddenAt: iso(row?.overriddenAt),
      configMonthlyPricePaise: p.monthlyPricePaise,
      prices: prices.filter((x) => x.planId === p.id).map(({ planId: _p, ...rest }) => rest),
      activeSubscribers: subs.find((s) => s.planId === p.id)?.n ?? 0,
    };
  });

  const presets: AdminPresetView[] = PRESET_SLUGS.map((slug) => {
    const st = presetStats.find((s) => s.slug === slug);
    return {
      slug,
      name: PRESETS[slug].name,
      enabled: presetSettings[slug].enabled,
      creditCost: presetSettings[slug].creditCost,
      defaultCreditCost: PRESETS[slug].creditCost,
      version: PRESETS[slug].version,
      jobs30d: st?.total ?? 0,
      failureRate30d: st && st.total > 0 ? st.failed / st.total : null,
    };
  });

  return {
    plans,
    trial: trial[0] ?? { credits: billingConfig.trial.credits, validityDays: billingConfig.trial.validityDays },
    packs: billingConfig.packs.map((p) => ({ ...p })),
    presets,
    pricesApproved: billingConfig.pricesApproved,
    billingMode: deps.billingMode,
  };
}

/* ----------------------------------------------------------------- write */

export async function updatePlan(deps: AdminDeps, ctx: AdminContext, raw: z.input<typeof planUpdateSchema>) {
  assertWrite(ctx);
  const input = planUpdateSchema.parse(raw);
  const plan = planById(input.planId);
  if (!plan) throw domainErrors.notFound("Plan");
  if (plan.monthlyPricePaise !== null && input.monthlyCredits < 1) {
    throw new DomainError("invalid_request", "Paid plans must include at least 1 credit a month.", 400);
  }
  const limits: PlanLimits = input.limits;
  await deps.db.transaction(async (tx) => {
    const before = await tx.query<{ monthlyCredits: number; limits: unknown; overriddenAt: unknown }>(
      `select monthly_credits as "monthlyCredits", limits, overridden_at as "overriddenAt" from public.plans where id = $1 for update`,
      [plan.id],
    );
    await tx.query(
      `insert into public.plans (id, name, monthly_credits, limits, is_paid, sort_order, active, overridden_at, overridden_by)
       values ($1, $2, $3, $4::jsonb, $5, $6, true, now(), $7)
       on conflict (id) do update set monthly_credits = excluded.monthly_credits, limits = excluded.limits,
         overridden_at = now(), overridden_by = excluded.overridden_by, updated_at = now()`,
      [plan.id, plan.name, input.monthlyCredits, JSON.stringify(limits), plan.monthlyPricePaise !== null, billingConfig.plans.indexOf(plan), ctx.userId],
    );
    const prev = before[0];
    await writeAudit(tx, ctx, {
      action: "plan.update",
      targetType: "plan",
      targetId: plan.id,
      reason: input.reason,
      details: {
        before: prev?.overriddenAt
          ? { monthlyCredits: prev.monthlyCredits, limits: typeof prev.limits === "string" ? JSON.parse(prev.limits) : prev.limits }
          : { monthlyCredits: plan.monthlyCredits, limits: plan.limits, source: "config" },
        after: { monthlyCredits: input.monthlyCredits, limits },
      },
    });
  });
  deps.revalidatePlans?.();
  return { planId: plan.id };
}

export async function resetPlan(deps: AdminDeps, ctx: AdminContext, input: { planId: string; reason: string }) {
  assertWrite(ctx);
  const reason = reasonSchema.parse(input.reason);
  const plan = planById(input.planId);
  if (!plan) throw domainErrors.notFound("Plan");
  await deps.db.transaction(async (tx) => {
    const res = await tx.query(
      `update public.plans set monthly_credits = $2, limits = $3::jsonb, overridden_at = null, overridden_by = null, updated_at = now()
        where id = $1 and overridden_at is not null returning id`,
      [plan.id, plan.monthlyCredits, JSON.stringify(plan.limits)],
    );
    if (!res.length) throw new DomainError("conflict", "This plan already uses the configured values.", 409);
    await writeAudit(tx, ctx, { action: "plan.reset", targetType: "plan", targetId: plan.id, reason });
  });
  deps.revalidatePlans?.();
  return { planId: plan.id };
}

export async function updateTrial(deps: AdminDeps, ctx: AdminContext, raw: z.input<typeof trialUpdateSchema>) {
  assertWrite(ctx);
  const input = trialUpdateSchema.parse(raw);
  await deps.db.transaction(async (tx) => {
    const before = await tx.query<{ credits: number; days: number }>(
      `select trial_credits as credits, trial_validity_days as days from public.billing_settings where id for update`,
    );
    await tx.query(`update public.billing_settings set trial_credits = $1, trial_validity_days = $2, updated_at = now() where id`, [
      input.credits,
      input.validityDays,
    ]);
    await writeAudit(tx, ctx, {
      action: "trial.update",
      targetType: "settings",
      targetId: "trial",
      reason: input.reason,
      details: { before: before[0] ?? null, after: { credits: input.credits, days: input.validityDays } },
    });
  });
  deps.revalidatePlans?.();
  return input;
}

export async function updatePreset(deps: AdminDeps, ctx: AdminContext, raw: z.input<typeof presetUpdateSchema>) {
  assertWrite(ctx);
  const input = presetUpdateSchema.parse(raw);
  await deps.db.transaction(async (tx) => {
    const before = (await loadPresetSettings(tx))[input.slug];
    // Lock all rows so two admins can't switch off the last two presets at once.
    await tx.query(`select 1 from public.preset_settings for update`);
    const current = await loadPresetSettings(tx);
    current[input.slug] = { enabled: input.enabled, creditCost: input.creditCost };
    if (!Object.values(current).some((s) => s.enabled)) {
      throw new DomainError("invalid_request", "At least one style must stay enabled.", 400);
    }
    await tx.query(
      `insert into public.preset_settings (slug, enabled, credit_cost, updated_by, updated_at) values ($1, $2, $3, $4, now())
       on conflict (slug) do update set enabled = excluded.enabled, credit_cost = excluded.credit_cost, updated_by = excluded.updated_by, updated_at = now()`,
      [input.slug, input.enabled, input.creditCost, ctx.userId],
    );
    await writeAudit(tx, ctx, {
      action: "preset.update",
      targetType: "preset",
      targetId: input.slug,
      reason: input.reason,
      details: { before, after: { enabled: input.enabled, creditCost: input.creditCost } },
    });
  });
  return { slug: input.slug };
}

import "server-only";

import { billingConfig, type PlanConfig } from "@/config/billing";
import { buildComparison, buildPricing, type TrialTerms } from "@/config/plans";
import { database } from "@/server/db/postgres";
import { supabaseAdmin } from "@/server/db/supabase-admin";

import { effectivePlan, type PlanOverrides, trialTermsSchema, validPlanOverrides } from "./plan-overrides";

/** Public pages render from the config file rather than wait longer than this for the database. */
export const DB_BUDGET_MS = 2_000;
/** A successful read is reused this long (per server instance / Worker isolate). */
export const PRICING_CACHE_TTL_MS = 5 * 60_000;
/** After a failed or slow read, don't try again (and don't make pages wait) for this long. */
export const PRICING_RETRY_AFTER_FAILURE_MS = 30_000;
/** While reads keep failing, keep serving the last good overrides for up to this long. */
export const PRICING_STALE_MAX_MS = 24 * 60 * 60_000;

/**
 * - database: read just now
 * - cache:    a read from the last PRICING_CACHE_TTL_MS
 * - stale:    the database is unavailable; last good read (younger than PRICING_STALE_MAX_MS)
 * - config:   no usable read; src/config/billing.ts as is
 */
export type PricingSource = "database" | "cache" | "stale" | "config";

interface Overrides {
  plans: PlanOverrides;
  trial: TrialTerms | null;
}

/**
 * Public pricing (homepage, /pricing, /login) with admin plan and trial
 * changes applied.
 *
 * Prices are never read from the database: they come from
 * src/config/billing.ts, the same values server-side order creation charges
 * (createPackOrder uses packById() and checks the credit_packs row matches).
 * Admins can only override plan credits and limits and the trial allowance.
 * So a missing, slow or invalid override can never change a price; the worst
 * case is that an admin's credit/limit/trial change shows a few minutes late.
 *
 * Why the cache: the read is two Supabase API calls (the plans and
 * billing_settings tables). Supabase answers in ~25 ms, but each call crosses
 * from the visitor's nearest Cloudflare edge to the project's region, so
 * together they take ~1–1.5 s and sometimes more than DB_BUDGET_MS, which
 * logged `pricing.overrides_unavailable` on every slow render. Results are now
 * cached; concurrent renders share one read; after a failure the next attempt
 * waits PRICING_RETRY_AFTER_FAILURE_MS (so pages don't keep waiting 2 s); and
 * the last good read is served while the database is unavailable.
 * invalidatePublicPricingCache() runs after admin plan/trial changes.
 */
export async function getPublicPricing() {
  const { overrides, source } = await currentOverrides();
  let plans: PlanConfig[] = billingConfig.plans;
  let trial: TrialTerms = { credits: billingConfig.trial.credits, validityDays: billingConfig.trial.validityDays };
  if (overrides) {
    plans = billingConfig.plans.map((p) => effectivePlan(p.id, overrides.plans)!);
    if (overrides.trial) trial = overrides.trial;
  }
  return { pricing: buildPricing(plans, trial), comparison: buildComparison(plans, trial), source };
}

// ------------------------------------------------------------------ cache

let good: { overrides: Overrides; at: number } | null = null;
let lastFailureAt = Number.NEGATIVE_INFINITY;
let inflight: Promise<Overrides | null> | null = null;
/** Bumped by invalidate(): a read that started earlier must not repopulate the cache. */
let generation = 0;

/** Drops this instance's cached overrides (admin plan or trial change). Other instances refresh within PRICING_CACHE_TTL_MS. */
export function invalidatePublicPricingCache() {
  good = null;
  lastFailureAt = Number.NEGATIVE_INFINITY;
  inflight = null;
  generation++;
}

async function currentOverrides(): Promise<{ overrides: Overrides | null; source: PricingSource }> {
  const now = Date.now();
  if (good && now - good.at < PRICING_CACHE_TTL_MS) return { overrides: good.overrides, source: "cache" };
  if (now - lastFailureAt < PRICING_RETRY_AFTER_FAILURE_MS) return fallback(now);

  const startedIn = generation;
  const read = (inflight ??= readWithBudget().finally(() => {
    if (inflight === read) inflight = null;
  }));
  try {
    const overrides = await read;
    if (!overrides) return { overrides: null, source: "config" }; // nothing configured (e.g. local dev without Supabase)
    if (startedIn === generation) good = { overrides, at: Date.now() };
    return { overrides, source: "database" };
  } catch (err) {
    if (startedIn === generation) lastFailureAt = Date.now();
    console.error(JSON.stringify({ event: "pricing.overrides_unavailable", error: String(err).slice(0, 300) }));
    return fallback(Date.now());
  }
}

function fallback(now: number): { overrides: Overrides | null; source: PricingSource } {
  if (good && now - good.at < PRICING_STALE_MAX_MS) return { overrides: good.overrides, source: "stale" };
  return { overrides: null, source: "config" };
}

// ------------------------------------------------------------------- read

/** One read, abandoned (and its requests aborted) after DB_BUDGET_MS. Rejects on timeout or error. */
async function readWithBudget(): Promise<Overrides | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`pricing overrides took over ${DB_BUDGET_MS}ms`));
    }, DB_BUDGET_MS);
  });
  const loaded = loadOverrides(controller.signal);
  loaded.catch(() => {}); // a late failure after the timeout must not surface as an unhandled rejection
  try {
    return await Promise.race([loaded, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const reportInvalid = (what: string, reason: string) =>
  console.error(JSON.stringify({ event: "pricing.override_invalid", override: what, reason }));

function validTrial(raw: { credits: unknown; validityDays: unknown } | null): TrialTerms | null {
  if (!raw) return null;
  const parsed = trialTermsSchema.safeParse(raw);
  if (!parsed.success) {
    reportInvalid("trial", "credits or validity out of range");
    return null;
  }
  return parsed.data;
}

/**
 * Supabase's HTTPS API first (works on Cloudflare Workers with full
 * certificate verification); Postgres as the fallback. null when neither is
 * configured.
 */
async function loadOverrides(signal: AbortSignal): Promise<Overrides | null> {
  const admin = supabaseAdmin();
  if (admin) {
    const [planRows, settings] = await Promise.all([
      admin.from("plans").select("id, monthly_credits, limits").not("overridden_at", "is", null).abortSignal(signal),
      admin.from("billing_settings").select("trial_credits, trial_validity_days").eq("id", true).abortSignal(signal).maybeSingle(),
    ]);
    if (planRows.error) throw new Error(`plans: ${planRows.error.message}`);
    if (settings.error) throw new Error(`billing_settings: ${settings.error.message}`);
    const rows = (planRows.data ?? []) as { id: string; monthly_credits: unknown; limits: unknown }[];
    const s = settings.data as { trial_credits: unknown; trial_validity_days: unknown } | null;
    return {
      plans: validPlanOverrides(rows.map((r) => ({ id: r.id, monthlyCredits: r.monthly_credits, limits: r.limits })), reportInvalid),
      trial: validTrial(s ? { credits: s.trial_credits, validityDays: s.trial_validity_days } : null),
    };
  }

  const db = database();
  if (!db) return null;
  const [rows, settings] = await Promise.all([
    db.query<{ id: string; monthlyCredits: unknown; limits: unknown }>(
      `select id, monthly_credits as "monthlyCredits", limits from public.plans where overridden_at is not null`,
    ),
    db.query<{ credits: unknown; validityDays: unknown }>(
      `select trial_credits as credits, trial_validity_days as "validityDays" from public.billing_settings where id`,
    ),
  ]);
  return { plans: validPlanOverrides(rows, reportInvalid), trial: validTrial(settings[0] ?? null) };
}

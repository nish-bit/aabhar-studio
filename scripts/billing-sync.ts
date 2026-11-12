/**
 * Copies plans and credit packs from src/config/billing.ts into the database
 * and creates the matching Razorpay Plans for the current key mode.
 *
 *   npm run billing:sync                             # dry run: shows what would change
 *   npm run billing:sync -- --apply                  # writes to the database and Razorpay
 *   npm run billing:sync -- --packs-only             # dry run, credit packs only
 *   npm run billing:sync -- --packs-only --apply     # writes public.credit_packs only
 *
 * --packs-only touches public.credit_packs and nothing else: never plans,
 * plan_prices or billing_settings, and never Razorpay (src/server/billing/pack-sync.ts).
 *
 * Reads DATABASE_URL (and DATABASE_SSL_CA) from the environment, falling back
 * to .env.local in the current directory for values that aren't already set.
 * The full sync also needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET for --apply,
 * and refuses live keys unless BILLING_LIVE_APPROVED=true.
 *
 * Razorpay Plans can't be edited, so a changed price creates a new Razorpay
 * Plan and marks the old price inactive. Existing subscribers stay on their
 * old price until they change plan.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import postgres from "postgres";

import { postgresSsl } from "../src/server/db/ssl";

import { billingConfig, paidPlans } from "@/config/billing";
import { RazorpayGateway } from "@/server/billing/gateway";
import { applyPackSync, describePackOperation, parseSyncArgs, previewPackSync } from "@/server/billing/pack-sync";
import { BillingRepository } from "@/server/billing/repository";
import type { Db, SqlParam } from "@/server/db/sql";

/** .env.local for local runs. Values already in the environment win; nothing is printed. */
function loadLocalEnv() {
  const file = resolve(process.cwd(), ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

function db(url: string): { db: Db; end: () => Promise<void> } {
  const sql = postgres(url, { prepare: false, max: 1, ssl: postgresSsl(url), onnotice: () => {} });
  const wrap = (c: postgres.Sql | postgres.TransactionSql): Db => ({
    query: async <T,>(text: string, params: SqlParam[] = []) => (await c.unsafe(text, params as never[])) as unknown as T[],
    transaction: async <T,>(fn: (tx: Db) => Promise<T>) => ("savepoint" in c ? fn(wrap(c)) : ((await (c as postgres.Sql).begin((tx) => fn(wrap(tx)))) as T)),
  });
  return { db: wrap(sql), end: () => sql.end({ timeout: 5 }) };
}

/** Error text with the connection string and its password removed. */
function sanitize(message: string): string {
  const url = process.env.DATABASE_URL;
  const secrets: string[] = [];
  if (url) {
    secrets.push(url);
    try {
      const pw = new URL(url).password;
      if (pw) secrets.push(pw, decodeURIComponent(pw));
    } catch {
      // not a URL: the whole value is already redacted
    }
  }
  for (const s of [process.env.RAZORPAY_KEY_SECRET, process.env.SUPABASE_SECRET_KEY]) if (s) secrets.push(s);
  return secrets.filter((s) => s.length >= 4).reduce((out, s) => out.split(s).join("[redacted]"), message);
}

async function packsOnly(conn: Db, apply: boolean) {
  console.log(`Credit packs only · ${apply ? "APPLY" : "dry run"} · plans, plan_prices, billing_settings and Razorpay are not touched`);
  const ops = apply ? await applyPackSync(conn, billingConfig.packs) : await previewPackSync(conn, billingConfig.packs);
  for (const op of ops) console.log(describePackOperation(op));
  const writes = ops.filter((o) => o.kind !== "unchanged").length;
  console.log(apply ? `Done: ${writes} row(s) written in one transaction.` : `Would write ${writes} row(s). Re-run with --apply to write them.`);
}

async function fullSync(conn: Db, apply: boolean) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const mode = keyId?.startsWith("rzp_live_") ? "live" : keyId?.startsWith("rzp_test_") ? "test" : null;
  if (mode === "live" && process.env.BILLING_LIVE_APPROVED !== "true") {
    throw new Error("Live Razorpay keys detected. Live billing is locked until BILLING_LIVE_APPROVED=true (set only after approval).");
  }
  console.log(`Mode: ${mode ?? "no Razorpay keys"} · ${apply ? "APPLY" : "dry run"}${billingConfig.pricesApproved ? "" : " · prices NOT yet approved"}`);

  const repo = new BillingRepository(conn);
  const gateway = apply && mode && keyId && keySecret ? new RazorpayGateway(keyId, keySecret) : null;
  for (const [i, p] of billingConfig.plans.entries()) {
    console.log(`plan  ${p.id.padEnd(8)} ${p.monthlyPricePaise === null ? "free" : `${p.monthlyPricePaise} paise`} · ${p.monthlyCredits} credits`);
    if (apply) await repo.upsertPlan({ id: p.id, name: p.name, monthlyCredits: p.monthlyCredits, limits: p.limits, isPaid: p.monthlyPricePaise !== null, sortOrder: i });
  }
  if (apply) {
    await conn.query(`update public.billing_settings set trial_credits = $1, trial_validity_days = $2, updated_at = now() where id`, [
      billingConfig.trial.credits,
      billingConfig.trial.validityDays,
    ]);
  }
  console.log(`trial ${billingConfig.trial.credits} credits for ${billingConfig.trial.validityDays} days (applies to new sign-ups)`);

  if (mode) {
    for (const p of paidPlans()) {
      const current = await repo.activePrice(p.id, mode);
      if (current && current.amountPaise === p.monthlyPricePaise) {
        console.log(`price ${p.id.padEnd(8)} up to date (${current.razorpayPlanId})`);
        continue;
      }
      console.log(`price ${p.id.padEnd(8)} ${current ? `changes ${current.amountPaise} → ${p.monthlyPricePaise}` : "new"}: Razorpay Plan will be created`);
      if (!gateway) continue;
      const created = await gateway.createPlan({
        name: `${p.name} (monthly)`,
        amountPaise: p.monthlyPricePaise,
        description: `${p.monthlyCredits} image credits a month`,
        notes: { plan_id: p.id },
      });
      await repo.insertPrice({ planId: p.id, mode, amountPaise: p.monthlyPricePaise, razorpayPlanId: created.id });
      console.log(`      created ${created.id}`);
    }
  } else {
    console.log("No Razorpay keys: skipping Razorpay Plans.");
  }

  for (const [i, k] of billingConfig.packs.entries()) {
    console.log(`pack  ${k.id.padEnd(8)} ${k.pricePaise} paise · ${k.credits} credits · ${k.validityDays} days`);
    if (apply) await repo.upsertPack({ id: k.id, name: k.name, credits: k.credits, amountPaise: k.pricePaise, validityDays: k.validityDays, sortOrder: i });
  }
  if (apply) await repo.deactivateMissingPacks(billingConfig.packs.map((k) => k.id));
}

async function main() {
  const args = parseSyncArgs(process.argv.slice(2));
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (in the environment or .env.local).");

  const { db: conn, end } = db(url);
  try {
    if (args.packsOnly) await packsOnly(conn, args.apply);
    else await fullSync(conn, args.apply);
  } finally {
    await end();
  }
}

main().catch((err) => {
  const code = (err as { code?: unknown })?.code;
  console.error(sanitize(`${typeof code === "string" ? `${code}: ` : ""}${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});

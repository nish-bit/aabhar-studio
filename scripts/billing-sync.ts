/**
 * Copies plans and credit packs from src/config/billing.ts into the database
 * and creates the matching Razorpay Plans for the current key mode.
 *
 *   npm run billing:sync              # dry run: shows what would change
 *   npm run billing:sync -- --apply   # writes to the database and Razorpay
 *
 * Needs DATABASE_URL and, for --apply, RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 * Refuses live keys unless BILLING_LIVE_APPROVED=true.
 *
 * Razorpay Plans can't be edited, so a changed price creates a new Razorpay
 * Plan and marks the old price inactive. Existing subscribers stay on their
 * old price until they change plan.
 */
import postgres from "postgres";

import { postgresSsl } from "../src/server/db/ssl";

import { billingConfig, paidPlans } from "@/config/billing";
import { RazorpayGateway } from "@/server/billing/gateway";
import { BillingRepository } from "@/server/billing/repository";
import type { Db, SqlParam } from "@/server/db/sql";

const apply = process.argv.includes("--apply");

function db(url: string): { db: Db; end: () => Promise<void> } {
  const sql = postgres(url, { prepare: false, max: 1, ssl: postgresSsl(url) });
  const wrap = (c: postgres.Sql | postgres.TransactionSql): Db => ({
    query: async <T,>(text: string, params: SqlParam[] = []) => (await c.unsafe(text, params as never[])) as unknown as T[],
    transaction: async <T,>(fn: (tx: Db) => Promise<T>) => ("savepoint" in c ? fn(wrap(c)) : ((await (c as postgres.Sql).begin((tx) => fn(wrap(tx)))) as T)),
  });
  return { db: wrap(sql), end: () => sql.end() };
}

async function main() {
  const url = process.env.DATABASE_URL;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const mode = keyId?.startsWith("rzp_live_") ? "live" : keyId?.startsWith("rzp_test_") ? "test" : null;
  if (mode === "live" && process.env.BILLING_LIVE_APPROVED !== "true") {
    throw new Error("Live Razorpay keys detected. Live billing is locked until BILLING_LIVE_APPROVED=true (set only after approval).");
  }
  console.log(`Mode: ${mode ?? "no Razorpay keys"} · ${apply ? "APPLY" : "dry run"}${billingConfig.pricesApproved ? "" : " · prices NOT yet approved"}`);

  const { db: conn, end } = db(url);
  const repo = new BillingRepository(conn);
  const gateway = apply && mode && keyId && keySecret ? new RazorpayGateway(keyId, keySecret) : null;
  try {
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
  } finally {
    await end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

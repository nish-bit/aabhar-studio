import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { billingConfig, type CreditPackConfig } from "@/config/billing";
import { RazorpayGateway } from "@/server/billing/gateway";
import { applyPackSync, parseSyncArgs, planPackSync, previewPackSync } from "@/server/billing/pack-sync";
import { BillingRepository } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";

import { createTestDatabase } from "../support/pglite-db";

/**
 * `npm run billing:sync -- --packs-only` (src/server/billing/pack-sync.ts), against the real
 * migrations in PGlite: it writes public.credit_packs and nothing else, and never calls Razorpay.
 */

vi.setConfig({ testTimeout: 30_000 });

let pg: PGlite;
let db: Db;

const CONFIGURED = [
  { id: "starter-pack", name: "Starter Pack", credits: 3, amount_paise: 24_900, validity_days: 365, sort_order: 0, active: true },
  { id: "solo", name: "Solo", credits: 20, amount_paise: 149_900, validity_days: 365, sort_order: 1, active: true },
  { id: "signature", name: "Signature", credits: 75, amount_paise: 399_900, validity_days: 365, sort_order: 2, active: true },
  { id: "studio", name: "Studio", credits: 500, amount_paise: 1_999_900, validity_days: 365, sort_order: 3, active: true },
];

async function packs() {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select id, name, credits, amount_paise::int as amount_paise, validity_days, sort_order, active from public.credit_packs order by sort_order, id`,
  );
  return rows;
}

/** Every other billing table, as JSON, to prove they don't change. */
async function otherBillingTables() {
  const out: Record<string, unknown> = {};
  for (const t of ["plans", "plan_prices", "billing_settings", "billing_orders", "billing_subscriptions", "billing_payments", "billing_refunds", "billing_receipts", "billing_webhook_events", "credit_grants", "credit_ledger"]) {
    const { rows } = await pg.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb) as rows from public.${t} x`);
    out[t] = rows;
  }
  return out;
}

/** The state this database is really in: plans synced long ago (trial at 10 credits), a price row, trial settings. */
async function seedLikeTheRealDatabase() {
  const repo = new BillingRepository(db);
  for (const [i, p] of billingConfig.plans.entries()) {
    await repo.upsertPlan({ id: p.id, name: p.name, monthlyCredits: p.id === "trial" ? 10 : p.monthlyCredits, limits: p.limits, isPaid: p.monthlyPricePaise !== null, sortOrder: i });
  }
  await repo.insertPrice({ planId: "growth", mode: "test", amountPaise: 249_900, razorpayPlanId: "plan_existing123" });
  await pg.query(`update public.billing_settings set trial_credits = 2, trial_validity_days = 30 where id`);
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let gatewaySpies: ReturnType<typeof vi.spyOn>[];

beforeEach(async () => {
  ({ pg, db } = await createTestDatabase());
  await seedLikeTheRealDatabase();
  fetchSpy = vi.spyOn(globalThis, "fetch");
  const methods = Object.getOwnPropertyNames(RazorpayGateway.prototype).filter((m) => m !== "constructor") as (keyof RazorpayGateway)[];
  gatewaySpies = methods.map((m) => vi.spyOn(RazorpayGateway.prototype, m as never));
}, 60_000);

afterEach(() => {
  // No network and no Razorpay call, ever, in any test of this file.
  expect(fetchSpy).not.toHaveBeenCalled();
  for (const s of gatewaySpies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("billing:sync --packs-only", () => {
  it("dry run reads only: it lists the four inserts and writes nothing", async () => {
    const before = await otherBillingTables();
    const ops = await previewPackSync(db, billingConfig.packs);
    expect(ops.map((o) => o.kind)).toEqual(["insert", "insert", "insert", "insert"]);
    expect(await packs()).toEqual([]);
    expect(await otherBillingTables()).toEqual(before);
  });

  it("inserts the four configured credit packs, active, with the configured credits and prices", async () => {
    const ops = await applyPackSync(db, billingConfig.packs);
    expect(ops.map((o) => [o.kind, o.kind === "insert" ? o.pack.id : null])).toEqual([
      ["insert", "starter-pack"], ["insert", "solo"], ["insert", "signature"], ["insert", "studio"],
    ]);
    expect(await packs()).toEqual(CONFIGURED);
    // And order creation's own check now accepts each of them.
    const repo = new BillingRepository(db);
    for (const k of billingConfig.packs) expect(await repo.packSynced({ id: k.id, credits: k.credits, amountPaise: k.pricePaise }), k.id).toBe(true);
  });

  it("is idempotent: running it again changes nothing and creates no duplicates", async () => {
    await applyPackSync(db, billingConfig.packs);
    const { rows: first } = await pg.query(`select id, updated_at from public.credit_packs order by id`);
    for (let i = 0; i < 3; i++) {
      const ops = await applyPackSync(db, billingConfig.packs);
      expect(ops.every((o) => o.kind === "unchanged")).toBe(true);
    }
    const { rows: again } = await pg.query(`select id, updated_at from public.credit_packs order by id`);
    expect(again).toEqual(first); // not even rewritten
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from public.credit_packs`);
    expect(rows[0]!.n).toBe(4);
  });

  it("updates existing rows in place (same id), reactivates a configured pack, and deactivates but keeps retired ones", async () => {
    await pg.query(
      `insert into public.credit_packs (id, name, credits, amount_paise, validity_days, sort_order, active) values
         ('signature', 'Old Signature', 70, 350000, 180, 9, true),
         ('starter-pack', 'Starter Pack', 3, 24900, 365, 0, false),
         ('pack-50', 'Old 50 pack', 50, 99900, 365, 5, true)`,
    );
    const ops = await applyPackSync(db, billingConfig.packs);
    expect(ops).toContainEqual(expect.objectContaining({ kind: "update", changes: ["name", "credits 70 → 75", "price 350000 → 399900 paise", "validity 180 → 365 days", "order 9 → 2"] }));
    expect(ops).toContainEqual(expect.objectContaining({ kind: "update", changes: ["reactivate"] }));
    expect(ops).toContainEqual({ kind: "deactivate", id: "pack-50" });

    const rows = await packs();
    expect(rows.filter((r) => r.id !== "pack-50")).toEqual(CONFIGURED);
    expect(rows.find((r) => r.id === "pack-50")).toMatchObject({ active: false, credits: 50 }); // kept for its earlier orders
    expect(rows).toHaveLength(5);
  });

  it("never modifies plans, plan_prices, billing_settings or any other billing table (the 10 trial credits stay)", async () => {
    const before = await otherBillingTables();
    await applyPackSync(db, billingConfig.packs);
    await applyPackSync(db, billingConfig.packs);
    expect(await otherBillingTables()).toEqual(before);
    const { rows } = await pg.query<{ c: number }>(`select monthly_credits as c from public.plans where id = 'trial'`);
    expect(rows[0]!.c).toBe(10);
  });

  it("refuses an invalid pack configuration before writing anything", async () => {
    const bad: CreditPackConfig[] = [...billingConfig.packs, { ...billingConfig.packs[1]! }]; // "solo" twice
    await expect(applyPackSync(db, bad)).rejects.toThrow('Pack id "solo" is configured twice.');
    await expect(applyPackSync(db, [{ id: "free", name: "Free", credits: 5, pricePaise: 0, validityDays: 30 }])).rejects.toThrow("at least 100 paise");
    expect(await packs()).toEqual([]);
  });

  it("rolls back every write if one fails part-way", async () => {
    // The fourth insert fails (as a lost connection would): the first three must be rolled back with it.
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce(async (fn) =>
      db.transaction(async (tx) => {
        let n = 0;
        return fn({ ...tx, query: async (text, params) => (/insert into public\.credit_packs/.test(text) && ++n === 4 ? Promise.reject(new Error("boom")) : tx.query(text, params)) });
      }),
    );
    await expect(applyPackSync(db, billingConfig.packs)).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalled();
    expect(await packs()).toEqual([]);
  });
});

describe("planPackSync", () => {
  it("doesn't deactivate rows that are already inactive", () => {
    const ops = planPackSync([{ id: "pack-50", name: "x", credits: 50, amountPaise: 99_900, validityDays: 365, sortOrder: 5, active: false }], []);
    expect(ops).toEqual([]);
  });
});

describe("billing:sync options", () => {
  it("parses --packs-only and --apply, and refuses anything else so a typo can't fall through to a full sync", () => {
    expect(parseSyncArgs([])).toEqual({ apply: false, packsOnly: false });
    expect(parseSyncArgs(["--packs-only"])).toEqual({ apply: false, packsOnly: true });
    expect(parseSyncArgs(["--packs-only", "--apply"])).toEqual({ apply: true, packsOnly: true });
    expect(() => parseSyncArgs(["--pack-only", "--apply"])).toThrow('Unknown option "--pack-only"');
    expect(() => parseSyncArgs(["--packs-only=true"])).toThrow("Unknown option");
  });

  it("the script's --packs-only branch only calls the pack sync: no repository, Razorpay, plans or settings", () => {
    const source = readFileSync(path.resolve(__dirname, "../../scripts/billing-sync.ts"), "utf8");
    const fn = /async function packsOnly\([^)]*\) \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(fn).toBeTruthy();
    // Code only: the log line may name the tables it leaves alone.
    const body = fn!.replace(/`[^`]*`|"[^"]*"/g, '""');
    for (const forbidden of ["Razorpay", "gateway", "BillingRepository", "repo.", "plans", "plan_prices", "billing_settings", "RAZORPAY"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(source).toMatch(/if \(args\.packsOnly\) await packsOnly\(conn, args\.apply\);\s*else await fullSync\(conn, args\.apply\);/);
  });
});

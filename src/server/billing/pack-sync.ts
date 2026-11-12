import type { CreditPackConfig } from "@/config/billing";
import type { Db } from "@/server/db/sql";

/**
 * `npm run billing:sync -- --packs-only`: copies the credit packs in
 * src/config/billing.ts into public.credit_packs and nothing else.
 *
 * - Touches only public.credit_packs: never plans, plan_prices or
 *   billing_settings, and never Razorpay (packs need no Razorpay object;
 *   each purchase creates its own Razorpay order at checkout).
 * - Rows are keyed by the pack id, so a re-run updates in place and can't
 *   create duplicates. A pack whose row already matches isn't written at all.
 * - Packs that are no longer configured are marked inactive, never deleted:
 *   earlier orders reference them.
 * - The read, the plan and every write happen in one transaction, with the
 *   rows locked, so a concurrent run can't interleave.
 */

export interface PackRow {
  id: string;
  name: string;
  credits: number;
  amountPaise: number;
  validityDays: number;
  sortOrder: number;
  active: boolean;
}

export type DesiredPack = Omit<PackRow, "active">;

export type PackOperation =
  | { kind: "insert"; pack: DesiredPack }
  | { kind: "update"; pack: DesiredPack; changes: string[] }
  | { kind: "unchanged"; id: string }
  | { kind: "deactivate"; id: string };

const PACK_ID = /^[a-z0-9-]{2,40}$/;

/** The configured packs as rows, after checking they are valid to sell. Throws before anything is written. */
export function desiredPacks(packs: readonly CreditPackConfig[]): DesiredPack[] {
  const seen = new Set<string>();
  return packs.map((k, i) => {
    if (!PACK_ID.test(k.id)) throw new Error(`Pack id "${k.id}" must be 2–40 lowercase letters, digits or hyphens.`);
    if (seen.has(k.id)) throw new Error(`Pack id "${k.id}" is configured twice.`);
    seen.add(k.id);
    if (!k.name.trim()) throw new Error(`Pack "${k.id}" has no name.`);
    if (!Number.isSafeInteger(k.credits) || k.credits <= 0) throw new Error(`Pack "${k.id}" must grant a positive whole number of credits.`);
    if (!Number.isSafeInteger(k.pricePaise) || k.pricePaise < 100) throw new Error(`Pack "${k.id}" must cost at least 100 paise.`);
    if (!Number.isSafeInteger(k.validityDays) || k.validityDays <= 0) throw new Error(`Pack "${k.id}" must be valid for a positive number of days.`);
    return { id: k.id, name: k.name, credits: k.credits, amountPaise: k.pricePaise, validityDays: k.validityDays, sortOrder: i };
  });
}

/** What a sync would do, given the rows in the database now. Pure. */
export function planPackSync(current: readonly PackRow[], packs: readonly CreditPackConfig[]): PackOperation[] {
  const desired = desiredPacks(packs);
  const byId = new Map(current.map((r) => [r.id, r]));
  const ops: PackOperation[] = desired.map((pack) => {
    const row = byId.get(pack.id);
    if (!row) return { kind: "insert", pack };
    const changes: string[] = [];
    if (row.name !== pack.name) changes.push("name");
    if (row.credits !== pack.credits) changes.push(`credits ${row.credits} → ${pack.credits}`);
    if (row.amountPaise !== pack.amountPaise) changes.push(`price ${row.amountPaise} → ${pack.amountPaise} paise`);
    if (row.validityDays !== pack.validityDays) changes.push(`validity ${row.validityDays} → ${pack.validityDays} days`);
    if (row.sortOrder !== pack.sortOrder) changes.push(`order ${row.sortOrder} → ${pack.sortOrder}`);
    if (!row.active) changes.push("reactivate");
    return changes.length ? { kind: "update", pack, changes } : { kind: "unchanged", id: pack.id };
  });
  const wanted = new Set(desired.map((p) => p.id));
  for (const row of current) {
    if (!wanted.has(row.id) && row.active) ops.push({ kind: "deactivate", id: row.id });
  }
  return ops;
}

const SELECT_PACKS = `select id, name, credits, amount_paise::int as "amountPaise", validity_days as "validityDays", sort_order as "sortOrder", active
   from public.credit_packs order by id`;

/** Insert or update one pack row, keyed by id (so it can never duplicate). */
export const UPSERT_PACK = `insert into public.credit_packs (id, name, credits, amount_paise, validity_days, sort_order, active, updated_at)
     values ($1, $2, $3, $4, $5, $6, true, now())
     on conflict (id) do update set name = excluded.name, credits = excluded.credits, amount_paise = excluded.amount_paise,
       validity_days = excluded.validity_days, sort_order = excluded.sort_order, active = true, updated_at = now()`;

/** Retire a pack that's no longer configured (the row stays: orders reference it). */
export const DEACTIVATE_PACK = `update public.credit_packs set active = false, updated_at = now() where id = $1 and active`;

/** Dry run: reads public.credit_packs only. */
export async function previewPackSync(db: Db, packs: readonly CreditPackConfig[]): Promise<PackOperation[]> {
  return planPackSync(await db.query<PackRow>(SELECT_PACKS), packs);
}

/** Apply: one transaction; only public.credit_packs is read or written. Returns what was done. */
export async function applyPackSync(db: Db, packs: readonly CreditPackConfig[]): Promise<PackOperation[]> {
  desiredPacks(packs); // validate before opening the transaction
  return db.transaction(async (tx) => {
    const current = await tx.query<PackRow>(`${SELECT_PACKS} for update`);
    const ops = planPackSync(current, packs);
    for (const op of ops) {
      if (op.kind === "insert" || op.kind === "update") {
        const p = op.pack;
        await tx.query(UPSERT_PACK, [p.id, p.name, p.credits, p.amountPaise, p.validityDays, p.sortOrder]);
      } else if (op.kind === "deactivate") {
        await tx.query(DEACTIVATE_PACK, [op.id]);
      }
    }
    return ops;
  });
}

/** One line per operation, for the CLI. Contains no credentials. */
export function describePackOperation(op: PackOperation): string {
  switch (op.kind) {
    case "insert":
      return `pack  ${op.pack.id.padEnd(13)} insert · ${op.pack.credits} credits · ${op.pack.amountPaise} paise · ${op.pack.validityDays} days`;
    case "update":
      return `pack  ${op.pack.id.padEnd(13)} update · ${op.changes.join(", ")}`;
    case "unchanged":
      return `pack  ${op.id.padEnd(13)} up to date`;
    case "deactivate":
      return `pack  ${op.id.padEnd(13)} deactivate (no longer configured; row kept for earlier orders)`;
  }
}

export interface SyncArgs {
  apply: boolean;
  packsOnly: boolean;
}

/** `--apply` and `--packs-only`; anything else is refused, so a typo can't fall through to a full sync. */
export function parseSyncArgs(argv: readonly string[]): SyncArgs {
  const known = new Set(["--apply", "--packs-only"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) throw new Error(`Unknown option ${unknown.map((a) => JSON.stringify(a)).join(", ")}. Use --packs-only and/or --apply.`);
  return { apply: argv.includes("--apply"), packsOnly: argv.includes("--packs-only") };
}

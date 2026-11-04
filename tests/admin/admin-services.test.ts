import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { getAdminConfig, resetPlan, updatePlan, updatePreset, updateTrial } from "@/server/admin/configuration";
import { listLedger, listWebhookEvents } from "@/server/admin/billing";
import { requireAdmin, type AdminContext } from "@/server/admin/guard";
import { errorSummary, getJobDetail, listJobs, retryJob } from "@/server/admin/jobs";
import { getMetrics } from "@/server/admin/metrics";
import { getUserDetail, grantPromoCredits, listUsers, setUserDisabled } from "@/server/admin/users";
import { queryAudit } from "@/server/admin/audit";
import { loadEntitlement } from "@/server/billing/entitlements";
import { BillingRepository } from "@/server/billing/repository";
import { DomainError } from "@/server/generation/domain-error";
import { loadPresetSettings } from "@/server/presets/settings";
import type { Db } from "@/server/db/sql";

import { failedJob, makeAdmin, testAdminDeps } from "../support/admin-fixtures";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Admin services against the real SQL. Covers who may do what, that every
 * change is audited with a reason, and that customer content never leaks
 * into admin views.
 */
let pg: PGlite;
let db: Db;
let deps: ReturnType<typeof testAdminDeps>;
let admin: AdminContext;
let support: AdminContext;
let customer: { userId: string; shopId: string };

const code = (c: string, status?: number) => (e: unknown) => e instanceof DomainError && e.code === c && (status === undefined || e.status === status);

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  deps = testAdminDeps(db);
  const a = await makeAdmin(pg, "admin");
  const s = await makeAdmin(pg, "support");
  admin = await requireAdmin(db, { id: a.userId, email: a.email }, "write", { ip: "203.0.113.5", userAgent: "vitest" });
  support = await requireAdmin(db, { id: s.userId, email: s.email }, "read");
  customer = await createUser(pg);
}, 60_000);

/* ========================================================== role checks */

describe("server-verified admin roles", () => {
  it("rejects anonymous (401) and normal users (404, area not revealed)", async () => {
    await expect(requireAdmin(db, null, "read")).rejects.toSatisfy(code("unauthenticated", 401));
    await expect(requireAdmin(db, { id: customer.userId, email: null }, "read")).rejects.toSatisfy(code("not_found", 404));
    await expect(requireAdmin(db, { id: randomUUID(), email: null }, "read")).rejects.toSatisfy(code("not_found", 404));
  });

  it("gives support read access only", async () => {
    const s = await makeAdmin(pg, "support");
    await expect(requireAdmin(db, { id: s.userId, email: null }, "read")).resolves.toMatchObject({ role: "support" });
    await expect(requireAdmin(db, { id: s.userId, email: null }, "write")).rejects.toSatisfy(code("forbidden", 403));
  });

  it("ignores revoked roles and disabled admin accounts", async () => {
    const r = await makeAdmin(pg, "admin");
    await pg.query("update public.platform_admins set revoked_at = now() where user_id = $1", [r.userId]);
    await expect(requireAdmin(db, { id: r.userId, email: null }, "read")).rejects.toSatisfy(code("not_found", 404));
    const d = await makeAdmin(pg, "admin");
    await pg.query("update public.profiles set disabled_at = now() where id = $1", [d.userId]);
    await expect(requireAdmin(db, { id: d.userId, email: null }, "read")).rejects.toSatisfy(code("not_found", 404));
  });

  it("refuses every mutation from a support context, even if a service is called directly", async () => {
    const reason = "testing support role";
    await expect(setUserDisabled(deps, support, { userId: customer.userId, disabled: true, reason })).rejects.toSatisfy(code("forbidden", 403));
    await expect(grantPromoCredits(deps, support, { shopId: customer.shopId, amount: 5, expiresInDays: null, reason, idempotencyKey: randomUUID() })).rejects.toSatisfy(code("forbidden"));
    await expect(updatePlan(deps, support, { planId: "starter", monthlyCredits: 1, limits: { maxActiveJobs: 1, dailyGenerations: 1, maxCatalogues: 1, maxCatalogueItems: 1, presets: "all" }, reason })).rejects.toSatisfy(code("forbidden"));
    await expect(updatePreset(deps, support, { slug: "velvet", enabled: false, creditCost: 2, reason })).rejects.toSatisfy(code("forbidden"));
    await expect(updateTrial(deps, support, { credits: 1, validityDays: 1, reason })).rejects.toSatisfy(code("forbidden"));
    await expect(retryJob(deps, support, { jobId: randomUUID(), reason })).rejects.toSatisfy(code("forbidden"));
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.platform_admins a join public.admin_audit_log l on l.actor_id = a.user_id where a.role = 'support'");
    expect(rows[0]!.n).toBe(0);
  });
});

/* ===================================================== account disabling */

describe("disabling accounts", () => {
  it("disables with a reason, blocks new work in SQL, and is audited", async () => {
    const victim = await createUser(pg);
    await expect(setUserDisabled(deps, admin, { userId: victim.userId, disabled: true, reason: "no" })).rejects.toThrow(/at least 5/);

    const r = await setUserDisabled(deps, admin, { userId: victim.userId, disabled: true, reason: "Bulk-uploading copyrighted catalogue photos" });
    expect(r).toMatchObject({ disabled: true, authBan: "applied" });
    expect(deps.bans).toContainEqual({ userId: victim.userId, banned: true });

    // The database itself refuses new jobs from a disabled account.
    await expect(failedJob(pg, { ...victim, errorCode: "timeout" })).rejects.toThrow(/account_disabled/);

    const audit = await queryAudit(db, { targetId: victim.userId, action: "user.disable" });
    expect(audit.items[0]).toMatchObject({ actorRole: "admin", reason: "Bulk-uploading copyrighted catalogue photos" });
    const { rows } = await pg.query<{ ip: string; user_agent: string }>("select ip, user_agent from public.admin_audit_log where target_id = $1 and action = 'user.disable'", [victim.userId]);
    expect(rows[0]).toEqual({ ip: "203.0.113.5", user_agent: "vitest" });

    await expect(setUserDisabled(deps, admin, { userId: victim.userId, disabled: true, reason: "again please" })).rejects.toSatisfy(code("conflict"));
    await setUserDisabled(deps, admin, { userId: victim.userId, disabled: false, reason: "Appeal accepted" });
    expect((await queryAudit(db, { targetId: victim.userId, action: "user.enable" })).total).toBe(1);
  });

  it("won't disable yourself or another active admin", async () => {
    await expect(setUserDisabled(deps, admin, { userId: admin.userId, disabled: true, reason: "testing self" })).rejects.toSatisfy(code("invalid_request"));
    await expect(setUserDisabled(deps, admin, { userId: support.userId, disabled: true, reason: "testing admin" })).rejects.toSatisfy(code("invalid_request"));
  });

  it("keeps the audit log append-only", async () => {
    await expect(pg.query("update public.admin_audit_log set reason = 'edited'")).rejects.toThrow(/append-only/);
    await expect(pg.query("delete from public.admin_audit_log")).rejects.toThrow(/append-only/);
  });
});

/* ======================================================== promo credits */

describe("promotional credits", () => {
  it("grants once per key with an expiry, shows customers a neutral ledger line, keeps the internal reason in the audit", async () => {
    const u = await createUser(pg);
    const key = randomUUID();
    const input = { shopId: u.shopId, amount: 25, expiresInDays: 30, reason: "Diwali launch partner — internal note", idempotencyKey: key };
    expect(await grantPromoCredits(deps, admin, input)).toMatchObject({ granted: true, balance: 27 });
    expect(await grantPromoCredits(deps, admin, input)).toMatchObject({ granted: false, balance: 27 });
    const ledger = await listLedger(deps, admin, { shopId: u.shopId });
    expect(ledger.items[0]).toMatchObject({ type: "grant", amount: 25, reason: "Promotional credits" });
    expect((await queryAudit(db, { targetId: u.shopId, action: "credits.promo_grant" })).items).toHaveLength(1);
    await expect(grantPromoCredits(deps, admin, { ...input, amount: 1_000_000, idempotencyKey: randomUUID() })).rejects.toThrow();
  });
});

/* =================================================== jobs, errors, retry */

describe("jobs and retries", () => {
  it("retries an eligible failure once, charging normally, and refuses ineligible ones", async () => {
    const u = await createUser(pg);
    const { jobId } = await failedJob(pg, { ...u, errorCode: "timeout" });
    const detail = await getJobDetail(deps, support, jobId);
    expect(detail.retry.eligible).toBe(true);
    expect(detail.attemptList).toHaveLength(1);

    const r = await retryJob(deps, admin, { jobId, reason: "Provider outage 14:05–14:20" });
    expect(deps.startJob).toHaveBeenCalledWith(r.jobId);
    expect(await new BillingRepository(db).balance(u.shopId)).toBe(1);
    const after = await getJobDetail(deps, admin, jobId);
    expect(after.retry).toMatchObject({ eligible: false, retriedAs: r.jobId });
    await expect(retryJob(deps, admin, { jobId, reason: "second try please" })).rejects.toSatisfy(code("invalid_request"));

    const blocked = await failedJob(pg, { ...u, errorCode: "content_blocked" });
    expect((await getJobDetail(deps, admin, blocked.jobId)).retry.eligible).toBe(false);
    await expect(retryJob(deps, admin, { jobId: blocked.jobId, reason: "should not work" })).rejects.toSatisfy(code("invalid_request"));
  });

  it("lists and filters jobs, and summarises errors", async () => {
    const page = await listJobs(deps, support, { status: "failed", errorCode: "timeout" });
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((j) => j.status === "failed" && j.errorCode === "timeout")).toBe(true);
    const s = await errorSummary(deps, support);
    expect(s.failedByCode.find((x) => x.errorCode === "timeout")?.retryable).toBe(true);
    expect(s.failedByCode.find((x) => x.errorCode === "content_blocked")?.retryable).toBe(false);
  });
});

/* ===================================================== privacy of views */

describe("customer privacy in admin views", () => {
  it("never returns prompts, storage paths, file names, payloads or contact details from webhooks", async () => {
    const u = await createUser(pg);
    const { jobId } = await failedJob(pg, { ...u, errorCode: "timeout", instructions: "PRIVATE-NOTE: grandmother's ring" });
    await pg.query(
      `insert into public.billing_webhook_events (event_id, event_type, mode, payload)
       values ('evt_priv', 'payment.captured', 'test', $1::jsonb)`,
      [JSON.stringify({ payload: { payment: { entity: { id: "pay_X1", amount: 59900, status: "captured", email: "customer@private.test", contact: "+919999999999", card: { last4: "4242" } } } } })],
    );
    const outputs = JSON.stringify([
      await getJobDetail(deps, admin, jobId),
      await listJobs(deps, admin, { shopId: u.shopId }),
      await getUserDetail(deps, admin, u.userId),
      await listWebhookEvents(deps, admin, { q: "evt_priv" }),
      await errorSummary(deps, admin),
    ]);
    for (const secret of ["PRIVATE-NOTE", "private-ring.jpg", "source.jpg", "upload.jpg", "customer@private.test", "+919999999999", "4242", "storage", "signedUrl"]) {
      expect(outputs).not.toContain(secret);
    }
    const job = await getJobDetail(deps, admin, jobId);
    expect(job).toMatchObject({ hasInstructions: true, instructionsLength: "PRIVATE-NOTE: grandmother's ring".length });
    expect((await listWebhookEvents(deps, admin, { q: "pay_X1" })).items[0]!.summary).toEqual({
      paymentId: "pay_X1", subscriptionId: null, refundId: null, amountPaise: 59900, status: "captured",
    });
  });

  it("records that an admin viewed a customer's account", async () => {
    const u = await createUser(pg);
    await getUserDetail(deps, support, u.userId);
    expect((await queryAudit(db, { targetId: u.userId, action: "user.view" })).items[0]).toMatchObject({ actorRole: "support" });
    // The account page lists admin *changes*; routine views stay in the full audit log.
    expect((await getUserDetail(deps, admin, u.userId)).audit.some((a) => a.action === "user.view")).toBe(false);
  });

  it("searches users by email and filters by status", async () => {
    const u = await createUser(pg);
    const { rows } = await pg.query<{ email: string }>("select email from auth.users where id = $1", [u.userId]);
    const found = await listUsers(deps, support, { q: rows[0]!.email.slice(0, 12) });
    expect(found.items.map((x) => x.id)).toContain(u.userId);
    const admins = await listUsers(deps, support, { status: "admin" });
    expect(admins.items.every((x) => x.adminRole !== null)).toBe(true);
    const wild = await listUsers(deps, support, { q: "%" }); // LIKE wildcards are escaped
    expect(wild.total).toBe(0);
  });
});

/* ============================================== plans, trial, presets */

describe("plans, trial and presets", () => {
  it("overrides plan limits at runtime, audits before/after, and can reset to config", async () => {
    const limits = { maxActiveJobs: 2, dailyGenerations: 7, maxCatalogues: 3, maxCatalogueItems: 20, presets: ["white-studio"] as string[] };
    await updatePlan(deps, admin, { planId: "trial", monthlyCredits: 10, limits: limits as never, reason: "Tighten trial during launch" });
    expect(deps.revalidatePlans).toHaveBeenCalled();
    const u = await createUser(pg);
    expect((await loadEntitlement(new BillingRepository(db), u.shopId)).limits).toEqual(limits);
    const audit = await queryAudit(db, { targetId: "trial", action: "plan.update" });
    expect(audit.items[0]!.details).toMatchObject({ after: { limits } });
    expect((await getAdminConfig(deps, support)).plans.find((p) => p.id === "trial")).toMatchObject({ overridden: true });

    await resetPlan(deps, admin, { planId: "trial", reason: "Back to defaults" });
    expect((await loadEntitlement(new BillingRepository(db), u.shopId)).limits.dailyGenerations).toBe(20);
  });

  it("changes preset availability and cost, but always keeps one style enabled", async () => {
    await updatePreset(deps, admin, { slug: "velvet", enabled: false, creditCost: 3, reason: "Velvet prompt regression" });
    expect((await loadPresetSettings(db)).velvet).toEqual({ enabled: false, creditCost: 3 });
    for (const slug of ["white-studio", "warm-ivory", "black-luxury", "marble"] as const) {
      await updatePreset(deps, admin, { slug, enabled: false, creditCost: 1, reason: "testing the last-one rule" });
    }
    await expect(updatePreset(deps, admin, { slug: "editorial", enabled: false, creditCost: 2, reason: "would disable all" })).rejects.toSatisfy(code("invalid_request"));
    for (const slug of ["white-studio", "warm-ivory", "black-luxury", "marble", "velvet"] as const) {
      await updatePreset(deps, admin, { slug, enabled: true, creditCost: slug === "velvet" || slug === "marble" ? 2 : 1, reason: "restore after test" });
    }
  });

  it("changes the trial allowance for new sign-ups", async () => {
    await updateTrial(deps, admin, { credits: 3, validityDays: 7, reason: "Abuse wave from disposable emails" });
    const u = await createUser(pg);
    expect(await new BillingRepository(db).balance(u.shopId)).toBe(3);
    await updateTrial(deps, admin, { credits: 10, validityDays: 30, reason: "Back to normal" });
  });
});

/* ================================================================ metrics */

describe("metrics", () => {
  it("reports test and live revenue separately", async () => {
    const m = await getMetrics(deps, support);
    expect(m.users.total).toBeGreaterThan(0);
    expect(m.jobs.daily).toHaveLength(14);
    expect(m.revenue.every((r) => r.mode === "test" || r.mode === "live")).toBe(true);
  });
});

/* ============================================ customer database access */

describe("customers can't reach admin data from the database", () => {
  it("denies the authenticated role on admin tables and moderation fields", async () => {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${customer.userId}', false);`);
    try {
      await expect(pg.query("select * from public.platform_admins")).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from public.admin_audit_log")).rejects.toThrow(/permission denied/);
      await expect(pg.query("insert into public.platform_admins (user_id, role, granted_by) values ($1, 'admin', 'me')", [customer.userId])).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.preset_settings set enabled = false")).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.profiles set disabled_at = null")).rejects.toThrow(/permission denied/);
      await expect(pg.query("select disabled_reason from public.profiles")).rejects.toThrow(/permission denied/);
      const own = await pg.query<{ id: string }>("select id, disabled_at from public.profiles");
      expect(own.rows.map((r) => r.id)).toEqual([customer.userId]);
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  });
});

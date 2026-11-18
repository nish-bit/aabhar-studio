import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { billingConfig, planById, type PlanLimits } from "@/config/billing";
import { PRESETS } from "@/lib/presets";
import { DomainError } from "@/server/generation/domain-error";
import { JOB_LEASE_SECONDS, submitGeneration, type GenerationDeps } from "@/server/generation/service";
import { sanitizedError } from "@/server/logging";
import type { ImageEditProvider } from "@/server/providers/image/types";

import { FakeRepository, FakeStorage } from "../support/fakes";

/**
 * submitGeneration sweeps stale jobs (expired lease, or queued and never started for 10 minutes)
 * before the active-jobs check, so a job whose runner was lost can't hold the trial's only slot.
 * Jobs with a valid lease still count. The SQL side is covered in tests/db/migration.test.ts.
 */

const TRIAL = planById("trial")!.limits;
const COST = PRESETS["white-studio"].creditCost;
const START_CREDITS = 10;
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

function setup(limits: PlanLimits = TRIAL) {
  const repo = new FakeRepository();
  let t = Date.parse("2026-11-15T10:00:00Z");
  repo.now = () => t;
  const logs: { event: string; data: Record<string, unknown> }[] = [];
  const provider = { id: "openai", model: "test-model", editImage: async () => { throw new Error("not called"); } } as unknown as ImageEditProvider;
  const userId = randomUUID();
  const shopId = repo.addShop(userId, START_CREDITS);
  const sourceImageId = repo.addReadySource(shopId, userId);
  const deps: GenerationDeps = {
    repo,
    storage: new FakeStorage(),
    provider,
    limits: { maxActiveJobs: 50, dailyLimit: 5000 },
    entitlements: async () => limits,
    log: (event, data) => logs.push({ event, data }),
  };
  const submit = () => submitGeneration(deps, userId, { sourceImageId, presetSlug: "white-studio", idempotencyKey: randomUUID() });
  return {
    repo,
    deps,
    logs,
    shopId,
    submit,
    advance: (ms: number) => void (t += ms),
    refundsFor: (jobId: string) => repo.ledger.filter((l) => l.key === `refund:job:${jobId}`),
  };
}

describe("stale generation jobs are released before the concurrency check", () => {
  it("keeps the limit of 1 for the trial and lapsed plans", () => {
    expect(TRIAL.maxActiveJobs).toBe(1);
    expect(billingConfig.lapsedLimits.maxActiveJobs).toBe(1);
  });

  it("expires a processing job whose lease ran out, refunds it, and lets the new generation start", async () => {
    const s = setup();
    const a = await s.submit();
    await s.repo.claimJob(a.jobId, JOB_LEASE_SECONDS);
    s.advance(JOB_LEASE_SECONDS * 1000 + 1_000);

    const b = await s.submit();
    expect(b.replayed).toBe(false);
    const old = s.repo.jobs.get(a.jobId)!;
    expect(old.status).toBe("failed");
    expect(old.errorCode).toBe("timeout");
    expect(old.refunded).toBe(true);
    expect(s.repo.jobs.get(b.jobId)!.status).toBe("queued");
    expect(await s.repo.getBalance(s.shopId)).toBe(START_CREDITS - COST); // A refunded, B charged
    expect(s.repo.ledgerSum(s.shopId)).toBe(await s.repo.getBalance(s.shopId));
    expect(s.logs).toContainEqual({ event: "generation.stale_jobs_expired", data: { expired: 1 } });
  });

  it("expires a queued job that never started within 10 minutes", async () => {
    const s = setup();
    const a = await s.submit();
    s.advance(10 * 60_000 + 1_000);

    const b = await s.submit();
    const old = s.repo.jobs.get(a.jobId)!;
    expect(old.status).toBe("failed");
    expect(old.errorCode).toBe("not_started");
    expect(old.refunded).toBe(true);
    expect(s.repo.jobs.get(b.jobId)!.status).toBe("queued");
  });

  it("does not expire a queued job younger than 10 minutes: the limit still applies", async () => {
    const s = setup();
    const a = await s.submit();
    s.advance(9 * 60_000);

    await expect(s.submit()).rejects.toSatisfy(isCode("too_many_active_jobs"));
    expect(s.repo.jobs.get(a.jobId)!.status).toBe("queued");
    expect(s.refundsFor(a.jobId)).toHaveLength(0);
  });

  it("does not expire a processing job whose lease is still valid", async () => {
    const s = setup();
    const a = await s.submit();
    await s.repo.claimJob(a.jobId, JOB_LEASE_SECONDS);
    s.advance(JOB_LEASE_SECONDS * 1000 - 5_000); // 5 s of lease left

    await expect(s.submit()).rejects.toSatisfy(isCode("too_many_active_jobs"));
    const job = s.repo.jobs.get(a.jobId)!;
    expect(job.status).toBe("processing");
    expect(job.refunded).toBe(false);
    expect(s.refundsFor(a.jobId)).toHaveLength(0);
    expect(await s.repo.getBalance(s.shopId)).toBe(START_CREDITS - COST);
  });

  it("a job's age alone never expires it while it is processing with a valid lease", async () => {
    const s = setup();
    const a = await s.submit();
    s.advance(20 * 60_000); // older than the 10-minute queued cut-off...
    await s.repo.claimJob(a.jobId, JOB_LEASE_SECONDS); // ...but claimed just now (e.g. a late queue delivery)

    await expect(s.submit()).rejects.toSatisfy(isCode("too_many_active_jobs"));
    expect(s.repo.jobs.get(a.jobId)!.status).toBe("processing");
  });

  it("refunds an expired job exactly once, however many sweeps and failures follow", async () => {
    const s = setup();
    const a = await s.submit();
    await s.repo.claimJob(a.jobId, JOB_LEASE_SECONDS);
    s.advance(JOB_LEASE_SECONDS * 1000 + 1_000);

    await s.submit(); // sweep 1 (this request)
    expect(await s.repo.expireStaleJobs()).toBe(0); // sweep 2 (poll or cron)
    expect(await s.repo.failJob(a.jobId, "timeout", "late", true)).toBe(false); // the late runner gives up
    s.advance(60_000);
    await expect(s.submit()).rejects.toSatisfy(isCode("too_many_active_jobs")); // B holds the slot; sweep 3

    expect(s.refundsFor(a.jobId)).toHaveLength(1);
    expect(s.refundsFor(a.jobId)[0]!.amount).toBe(COST);
    expect(await s.repo.getBalance(s.shopId)).toBe(START_CREDITS - COST);
    expect(s.repo.ledgerSum(s.shopId)).toBe(await s.repo.getBalance(s.shopId));
  });

  it("concurrent submissions after a cleanup still respect the limit: exactly one starts", async () => {
    const s = setup();
    const a = await s.submit();
    await s.repo.claimJob(a.jobId, JOB_LEASE_SECONDS);
    s.advance(JOB_LEASE_SECONDS * 1000 + 1_000);

    const results = await Promise.allSettled([s.submit(), s.submit(), s.submit()]);
    const started = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const r of refused) expect(isCode("too_many_active_jobs")((r as PromiseRejectedResult).reason)).toBe(true);

    const active = [...s.repo.jobs.values()].filter((j) => j.status === "queued" || j.status === "processing");
    expect(active).toHaveLength(1);
    expect(s.refundsFor(a.jobId)).toHaveLength(1);
    expect(await s.repo.getBalance(s.shopId)).toBe(START_CREDITS - COST);
    expect(s.repo.ledgerSum(s.shopId)).toBe(await s.repo.getBalance(s.shopId));
  });

  it("concurrent submissions with no stale job: exactly one starts", async () => {
    const s = setup();
    const results = await Promise.allSettled([s.submit(), s.submit()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await s.repo.getBalance(s.shopId)).toBe(START_CREDITS - COST);
  });

  it("sweeps before the active-jobs check, and only once per submission", async () => {
    const s = setup();
    const order: string[] = [];
    const expire = s.repo.expireStaleJobs.bind(s.repo);
    const create = s.repo.createJobWithDebit.bind(s.repo);
    s.repo.expireStaleJobs = async () => (order.push("expire"), expire());
    s.repo.createJobWithDebit = async (p) => (order.push("create"), create(p));
    await s.submit();
    expect(order).toEqual(["expire", "create"]);
  });

  it("a failed sweep doesn't block the submission, is logged without sensitive details, and the limit still holds", async () => {
    const s = setup();
    // Credential-shaped values are assembled at runtime so secret scanners don't flag these fake fixtures.
    const fakeUrl = ["postgresql://", "postgres.ref:hunter2", "@", "pooler.supabase.com", ":6543/postgres"].join("");
    const fakeKey = ["sb", "secret", "abcdef123456"].join("_");
    const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "e30", "sig"].join(".");
    s.repo.expireStaleJobs = vi.fn(async () => {
      throw new Error(`expireStaleJobs: connect failed ${fakeUrl} for owner@example.com key ${fakeKey} jwt ${fakeJwt}`);
    });

    const a = await s.submit(); // nothing active: goes ahead
    expect(s.repo.jobs.get(a.jobId)!.status).toBe("queued");
    await expect(s.submit()).rejects.toSatisfy(isCode("too_many_active_jobs")); // the limit is unchanged

    const failures = s.logs.filter((l) => l.event === "generation.expire_stale_failed");
    expect(failures).toHaveLength(2);
    const logged = String(failures[0]!.data.error);
    expect(logged).toContain("expireStaleJobs: connect failed");
    for (const secret of ["hunter2", "postgresql://", "pooler.supabase.com", "owner@example.com", "sb_secret_", "eyJhbGci"]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged.length).toBeLessThanOrEqual(200);
  });

  it("sanitizedError handles non-Error values and long messages", () => {
    expect(sanitizedError("plain text")).toBe("plain text");
    expect(sanitizedError(new Error("x".repeat(500))).length).toBe(200);
    expect(sanitizedError(new TypeError("line1\nline2"))).toBe("TypeError: line1 line2");
  });
});

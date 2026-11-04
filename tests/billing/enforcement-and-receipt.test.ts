import { randomUUID } from "node:crypto";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { billingConfig, planById, type PlanLimits } from "@/config/billing";
import { computeEntitlement, entitlementsLookup } from "@/server/billing/entitlements";
import { renderReceiptPdf } from "@/server/billing/receipt-document";
import { BillingRepository, type SubscriptionRow } from "@/server/billing/repository";
import type { ReceiptData } from "@/server/billing/service";
import { CatalogueRepository } from "@/server/catalogue/repository";
import { createCatalogue } from "@/server/catalogue/service";
import { DomainError } from "@/server/generation/domain-error";
import { submitGeneration, type GenerationDeps } from "@/server/generation/service";
import type { ImageEditProvider } from "@/server/providers/image/types";
import { MemoryObjectStorage } from "@/server/storage/memory";

import { FakeRepository, FakeStorage } from "../support/fakes";
import { createTestDatabase, createUser } from "../support/pglite-db";

const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

/* ------------------------------------------------------ entitlement rules */

describe("entitlements", () => {
  const sub = (status: SubscriptionRow["status"], endsInDays: number): SubscriptionRow => ({
    id: "s", shopId: "x", planId: "growth", priceId: "p", mode: "test", razorpaySubscriptionId: "sub_1", status,
    currentStart: new Date().toISOString(), currentEnd: new Date(Date.now() + endsInDays * 86_400_000).toISOString(),
    cancelAtCycleEnd: false, scheduledPlanId: null, endedAt: null, shortUrl: null, lastEventAt: null, createdAt: new Date().toISOString(), amountPaise: 1,
  });
  const growth = planById("growth")!.limits;

  it.each([
    [null, "trial", planById("trial")!.limits],
    [sub("active", 10), "subscribed", growth],
    [sub("pending", 10), "past_due", growth],
    [sub("halted", 10), "past_due", billingConfig.lapsedLimits],
    [sub("cancelled", 10), "grace", growth],
    [sub("cancelled", -1), "lapsed", billingConfig.lapsedLimits],
    [sub("expired", -1), "lapsed", billingConfig.lapsedLimits],
  ] as [SubscriptionRow | null, string, PlanLimits][])("%# → %s", (s, state, limits) => {
    const e = computeEntitlement(s);
    expect(e.state).toBe(state);
    expect(e.limits).toEqual(limits);
  });

  it.each([
    [null, "pack"],
    [sub("halted", 10), "pack"],
    [sub("expired", -1), "pack"],
    [sub("active", 10), "subscribed"],
    [sub("cancelled", 10), "grace"],
  ] as [SubscriptionRow | null, string][])("pack buyer %# → %s (never less than the pack limits)", (s, state) => {
    const e = computeEntitlement(s, new Date(), undefined, true);
    expect(e.state).toBe(state);
    if (state === "pack") expect(e.limits).toEqual(billingConfig.packLimits);
  });

  it("pack limits unlock all six styles with the former Growth limits; the trial keeps the essential three", () => {
    expect(billingConfig.packLimits).toEqual({ maxActiveJobs: 3, dailyGenerations: 300, maxCatalogues: 25, maxCatalogueItems: 100, presets: "all" });
    expect(planById("trial")!.limits.presets).toEqual(["white-studio", "warm-ivory", "black-luxury"]);
  });
});

/* ------------------------------------------------- server-side enforcement */

describe("plan limits are enforced on the server", () => {
  function generationSetup(limits: PlanLimits) {
    const repo = new FakeRepository();
    const provider = { id: "openai", model: "test-model", edit: async () => { throw new Error("not called"); } } as unknown as ImageEditProvider;
    const userId = randomUUID();
    const shopId = repo.addShop(userId, 50);
    const sourceId = repo.addReadySource(shopId, userId);
    const deps: GenerationDeps = {
      repo,
      storage: new FakeStorage(),
      provider,
      limits: { maxActiveJobs: 50, dailyLimit: 5000 },
      entitlements: async () => limits,
    };
    return { deps, userId, sourceId };
  }

  it("blocks styles outside the plan", async () => {
    const { deps, userId, sourceId } = generationSetup(planById("trial")!.limits);
    await expect(submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "velvet", idempotencyKey: randomUUID() })).rejects.toSatisfy(
      isCode("plan_limit"),
    );
    await expect(submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: randomUUID() })).resolves.toBeTruthy();
  });

  it("uses the plan's concurrency limit instead of the fallback", async () => {
    const { deps, userId, sourceId } = generationSetup({ ...planById("trial")!.limits, maxActiveJobs: 1 });
    await submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: randomUUID() });
    await expect(submitGeneration(deps, userId, { sourceImageId: sourceId, presetSlug: "white-studio", idempotencyKey: randomUUID() })).rejects.toSatisfy(
      isCode("too_many_active_jobs"),
    );
  });

  it("caps catalogues by plan using the shop's real subscription records", async () => {
    const { pg, db } = await createTestDatabase();
    const u = await createUser(pg);
    const deps = { repo: new CatalogueRepository(db), storage: new MemoryObjectStorage(), entitlements: entitlementsLookup(new BillingRepository(db)) };
    await createCatalogue(deps, u.userId, "First");
    await expect(createCatalogue(deps, u.userId, "Second")).rejects.toSatisfy(isCode("plan_limit")); // trial allows 1
  }, 30_000);
});

/* ---------------------------------------------------------------- receipt */

describe("receipt PDF", () => {
  it("renders a labelled test-mode payment receipt with the rupee amount and no card data", async () => {
    const data: ReceiptData = {
      receiptNumber: "AS/2026-27/000001",
      issuedAt: "2026-10-20T06:30:00.000Z",
      mode: "test",
      payment: {
        id: randomUUID(), kind: "pack", description: "50 credits — image credits", amountPaise: 59_900, amountRefundedPaise: 0,
        status: "captured", method: "card", errorDescription: null, creditsGranted: 50, createdAt: "2026-10-20T06:29:00.000Z",
        receiptAvailable: true, razorpayPaymentId: "pay_TEST123", capturedAt: "2026-10-20T06:29:30.000Z",
      },
      buyer: { name: "Test Jewellers (test data)", email: "owner@example.test", phone: "", address: "" },
      seller: billingConfig.receipts.seller,
      pricesIncludeGst: true,
      gstRatePercent: 18,
    };
    const pdf = await renderReceiptPdf(data);
    const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    await task.destroy();

    expect(doc.numPages).toBe(1);
    expect(text).toContain("Payment receipt");
    expect(text).toContain("TEST MODE");
    expect(text).toContain("AS/2026-27/000001");
    expect(text).toContain("₹599");
    expect(text).toContain("not a tax invoice");
    expect(text).toContain("Seller details not yet configured");
  }, 30_000);
});

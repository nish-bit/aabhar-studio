import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { queryAudit } from "@/server/admin/audit";
import { requireAdmin, type AdminContext } from "@/server/admin/guard";
import { BillingRepository } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";
import type { ObjectStorage } from "@/server/generation/ports";
import {
  createRefundRequest,
  decideRefundRequest,
  listMyRefundRequests,
  listRefundableImages,
  listRefundRequestsForAdmin,
} from "@/server/support/refund-requests";
import { createTicket, listMyTickets, listTicketsForAdmin, newTicketReference, respondToTicket } from "@/server/support/tickets";

import { makeAdmin } from "../support/admin-fixtures";
import { createTestDatabase, createUser, insertGeneratedImage } from "../support/pglite-db";

/** Refund requests and support tickets on the real migrations (migration 20261103000400). */
let pg: PGlite;
let db: Db;
let admin: AdminContext;
let support: AdminContext;
const storage = { signedUrl: async (_b: string, p: string) => `https://signed.example/${p}` } as unknown as ObjectStorage;
const deps = () => ({ db, storage });
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  const a = await makeAdmin(pg, "admin");
  const s = await makeAdmin(pg, "support");
  admin = await requireAdmin(db, { id: a.userId, email: a.email }, "write");
  support = await requireAdmin(db, { id: s.userId, email: s.email }, "read");
}, 60_000);

describe("refund requests", () => {
  it("a customer picks their own recent photos with a reason; each photo can only be requested once", async () => {
    const u = await createUser(pg);
    const a = await insertGeneratedImage(pg, { ...u });
    const b = await insertGeneratedImage(pg, { ...u });
    expect((await listRefundableImages(deps(), u.userId)).map((i) => i.generatedImageId).sort()).toEqual([a.generatedImageId, b.generatedImageId].sort());

    await expect(createRefundRequest(deps(), u.userId, { imageIds: [a.generatedImageId], reason: "short" })).rejects.toThrow();
    const reqs = await createRefundRequest(deps(), u.userId, { imageIds: [a.generatedImageId], reason: "The stones changed colour completely." });
    expect(reqs[0]).toMatchObject({ status: "pending", creditsRequested: 1, images: [{ generatedImageId: a.generatedImageId }] });
    expect((await listRefundableImages(deps(), u.userId)).map((i) => i.generatedImageId)).toEqual([b.generatedImageId]);

    await expect(createRefundRequest(deps(), u.userId, { imageIds: [a.generatedImageId], reason: "Asking again for the same photo." })).rejects.toSatisfy(code("conflict"));
  });

  it("can't include another shop's photo", async () => {
    const u = await createUser(pg);
    const other = await createUser(pg);
    const theirs = await insertGeneratedImage(pg, { ...other });
    await expect(createRefundRequest(deps(), u.userId, { imageIds: [theirs.generatedImageId], reason: "This one isn't mine at all." })).rejects.toSatisfy(code("invalid_request"));
  });

  it("approval returns the credits exactly once, is audited, and is admin-only; rejection needs a note", async () => {
    const u = await createUser(pg);
    const img = await insertGeneratedImage(pg, { ...u });
    const [req] = await createRefundRequest(deps(), u.userId, { imageIds: [img.generatedImageId], reason: "Missing a pearl drop on the left." });
    const before = await new BillingRepository(db).balance(u.shopId);

    await expect(decideRefundRequest(db, support, req!.id, { decision: "approved", note: "Looks wrong" })).rejects.toSatisfy(code("forbidden"));
    await expect(decideRefundRequest(db, admin, req!.id, { decision: "rejected", note: "" })).rejects.toSatisfy(code("invalid_request"));
    expect((await listRefundRequestsForAdmin({ db, storage }, support, "pending")).map((r) => r.id)).toContain(req!.id);

    await decideRefundRequest(db, admin, req!.id, { decision: "approved", note: "Agreed, the drop is missing." });
    await expect(decideRefundRequest(db, admin, req!.id, { decision: "approved", note: "again please" })).rejects.toSatisfy(code("conflict"));
    expect(await new BillingRepository(db).balance(u.shopId)).toBe(before + 1);
    const mine = await listMyRefundRequests(deps(), u.userId);
    expect(mine[0]).toMatchObject({ status: "approved", creditsReturned: 1, adminNote: "Agreed, the drop is missing." });
    const { rows } = await pg.query<{ source: string }>("select source from public.credit_grants where shop_id = $1 and idempotency_key = $2", [u.shopId, `refund-request:${req!.id}`]);
    expect(rows).toEqual([{ source: "refund_request" }]);
    expect((await queryAudit(db, { action: "refund_request.approve", targetId: req!.id })).items).toHaveLength(1);
  });
});

describe("support tickets", () => {
  it("creates tickets with a TKT reference, shows each user only their own, and uses their sign-in email", async () => {
    expect(newTicketReference()).toMatch(/^TKT-[A-Z0-9]{8}-[A-Z0-9]{4}$/);
    const u = await createUser(pg);
    const other = await createUser(pg);
    await expect(createTicket(db, u.userId, { subject: "Hi", description: "short" })).rejects.toThrow();
    const tickets = await createTicket(db, u.userId, { subject: "Download button", description: "The download button does nothing on my phone." });
    expect(tickets[0]).toMatchObject({ status: "open", email: `${u.userId}@test.local` });
    expect(tickets[0]!.reference).toMatch(/^TKT-[A-Z0-9]{8}-[A-Z0-9]{4}$/);
    expect(await listMyTickets(db, other.userId)).toEqual([]);
  });

  it("admins answer and change status (audited); support can read but not answer", async () => {
    const u = await createUser(pg);
    const [t] = await createTicket(db, u.userId, { subject: "Question", description: "Can I use the photos on Amazon listings?" });
    expect((await listTicketsForAdmin(db, support, "open")).map((x) => x.id)).toContain(t!.id);
    await expect(respondToTicket(db, support, t!.id, { response: "Yes", status: "answered" })).rejects.toSatisfy(code("forbidden"));
    await expect(respondToTicket(db, admin, t!.id, { response: "", status: "answered" })).rejects.toSatisfy(code("invalid_request"));
    await respondToTicket(db, admin, t!.id, { response: "Yes, they're yours to use commercially.", status: "answered" });
    await respondToTicket(db, admin, t!.id, { response: "", status: "closed" }); // status only, keeps the answer
    expect((await listMyTickets(db, u.userId))[0]).toMatchObject({ status: "closed", adminResponse: "Yes, they're yours to use commercially." });
    expect((await queryAudit(db, { action: "support.respond", targetId: t!.id })).items).toHaveLength(2);
  });
});

describe("access", () => {
  it("customers can't read or write these tables directly", async () => {
    const u = await createUser(pg);
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u.userId}', false);`);
    try {
      for (const t of ["referral_codes", "referrals", "refund_requests", "refund_request_items", "support_tickets"]) {
        await expect(pg.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  });
});

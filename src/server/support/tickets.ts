import { randomInt } from "node:crypto";

import { z } from "zod";

import type { TicketView } from "@/lib/support-types";
import { writeAudit } from "@/server/admin/audit";
import { assertWrite, type AdminContext } from "@/server/admin/guard";
import { iso } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";
import { DomainError, domainErrors } from "@/server/generation/domain-error";

/**
 * Support tickets: anything that isn't a refund. Each gets a reference like
 * TKT-7KQ2M9XA-4F2B. Replies go to the account's sign-in email (read from
 * auth.users, never typed in); there's no email provider yet, so the
 * answer is shown on the Plans page and the admin emails the customer.
 */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const block = (n: number) => Array.from({ length: n }, () => CHARS[randomInt(CHARS.length)]).join("");
export const newTicketReference = () => `TKT-${block(8)}-${block(4)}`;


export const createTicketSchema = z
  .object({
    subject: z.string().trim().min(3, "Add a short subject.").max(120),
    description: z.string().trim().min(10, "Describe the problem (at least 10 characters).").max(4000),
  })
  .strict();

const COLS = `t.id, t.reference, t.subject, t.description, t.status, t.admin_response as "adminResponse",
  t.responded_at as "respondedAt", t.created_at as "createdAt", u.email`;

type Row = Omit<TicketView, "respondedAt" | "createdAt"> & { respondedAt: Date | string | null; createdAt: Date | string };
const view = (r: Row): TicketView => ({ ...r, respondedAt: iso(r.respondedAt), createdAt: iso(r.createdAt)! });

export async function createTicket(db: Db, userId: string, raw: unknown): Promise<TicketView[]> {
  const input = createTicketSchema.parse(raw);
  const shop = await db.query<{ shopId: string }>(
    `select shop_id as "shopId" from public.shop_members where user_id = $1 order by created_at limit 1`,
    [userId],
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.query(
        `insert into public.support_tickets (reference, shop_id, user_id, subject, description) values ($1, $2, $3, $4, $5)`,
        [newTicketReference(), shop[0]?.shopId ?? null, userId, input.subject, input.description],
      );
      return listMyTickets(db, userId);
    } catch (err) {
      if (!/support_tickets_reference_key|duplicate key/i.test(String(err))) throw err;
    }
  }
  throw new Error("Couldn't create a ticket reference");
}

export async function listMyTickets(db: Db, userId: string): Promise<TicketView[]> {
  const rows = await db.query<Row>(
    `select ${COLS} from public.support_tickets t left join auth.users u on u.id = t.user_id
      where t.user_id = $1 order by t.created_at desc limit 50`,
    [userId],
  );
  return rows.map(view);
}

/* ------------------------------------------------------------------ admin */

export async function listTicketsForAdmin(db: Db, _ctx: AdminContext, status: TicketView["status"] | null): Promise<TicketView[]> {
  const rows = await db.query<Row>(
    `select ${COLS} from public.support_tickets t left join auth.users u on u.id = t.user_id
      ${status ? "where t.status = $1" : ""} order by t.created_at desc limit 100`,
    status ? [status] : [],
  );
  return rows.map(view);
}

export const respondTicketSchema = z
  .object({
    response: z.string().trim().max(4000).optional().default(""),
    status: z.enum(["answered", "closed", "open"]),
  })
  .strict();

/** Saves the admin's reply and/or status. Admin role only; audited. */
export async function respondToTicket(db: Db, ctx: AdminContext, id: string, raw: unknown) {
  assertWrite(ctx);
  const input = respondTicketSchema.parse(raw);
  return db.transaction(async (tx) => {
    const current = await tx.query<{ answered: boolean }>(
      `select admin_response is not null as answered from public.support_tickets where id = $1 for update`,
      [id],
    );
    if (!current[0]) throw domainErrors.notFound("Ticket");
    if (input.status === "answered" && input.response.length < 2 && !current[0].answered) {
      throw new DomainError("invalid_request", "Write the answer the customer will see.", 400);
    }
    const rows = await tx.query<{ reference: string }>(
      `update public.support_tickets
          set status = $2, updated_at = now(),
              admin_response = coalesce(nullif($3, ''), admin_response),
              responded_by = case when $3 <> '' then $4::uuid else responded_by end,
              responded_at = case when $3 <> '' then now() else responded_at end
        where id = $1 returning reference`,
      [id, input.status, input.response, ctx.userId],
    );
    if (!rows[0]) throw domainErrors.notFound("Ticket");
    await writeAudit(tx, ctx, {
      action: "support.respond",
      targetType: "support_ticket",
      targetId: id,
      reason: null,
      details: { reference: rows[0].reference, status: input.status, answered: input.response !== "" },
    });
    return { id, status: input.status };
  });
}

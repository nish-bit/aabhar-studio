import type { AdminAuditRow, Page } from "@/lib/admin-types";
import type { Db } from "@/server/db/sql";
import { iso } from "@/server/billing/repository";

import type { AdminContext } from "./guard";
import { pageOf, type PageInput } from "./pagination";

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  details?: Record<string, unknown>;
}

/**
 * Writes one audit row. Call it inside the same transaction as the change,
 * so a change can't happen without its audit record (and vice versa).
 */
export async function writeAudit(db: Db, ctx: AdminContext, e: AuditEntry) {
  await db.query(
    `insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id, reason, details, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [ctx.userId, ctx.role, e.action, e.targetType, e.targetId, e.reason, JSON.stringify(e.details ?? {}), ctx.ip, ctx.userAgent],
  );
}

export interface AuditFilter extends PageInput {
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Any of these target ids (e.g. a user and their shop). */
  targetIds?: string[];
  actor?: string | null;
  /** Leave out these actions (e.g. routine "user.view" entries). */
  excludeActions?: string[];
}

export async function queryAudit(db: Db, f: AuditFilter): Promise<Page<AdminAuditRow>> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, v: string) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.action) add("l.action = ?", f.action);
  if (f.targetType) add("l.target_type = ?", f.targetType);
  if (f.targetId) add("l.target_id = ?", f.targetId);
  if (f.targetIds?.length) add("l.target_id = any(string_to_array(?, ','))", f.targetIds.join(","));
  if (f.excludeActions?.length) add("not (l.action = any(string_to_array(?, ',')))", f.excludeActions.join(","));
  if (f.actor) add("u.email ilike ?", `%${f.actor.replace(/[%_\\]/g, "\\$&")}%`);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const { limit, offset, page, pageSize } = pageOf(f);
  const [rows, count] = await Promise.all([
    db.query<AdminAuditRow & { id: string | number }>(
      `select l.id::text as id, l.created_at as "createdAt", u.email as "actorEmail", l.actor_role as "actorRole", l.action,
              l.target_type as "targetType", l.target_id as "targetId", l.reason, l.details
         from public.admin_audit_log l left join auth.users u on u.id = l.actor_id
         ${w} order by l.id desc limit ${limit} offset ${offset}`,
      params,
    ),
    db.query<{ n: number }>(`select count(*)::int as n from public.admin_audit_log l left join auth.users u on u.id = l.actor_id ${w}`, params),
  ]);
  return {
    items: rows.map((r) => ({ ...r, id: String(r.id), createdAt: iso(r.createdAt)!, details: typeof r.details === "string" ? JSON.parse(r.details) : r.details })),
    page,
    pageSize,
    total: count[0]?.n ?? 0,
  };
}

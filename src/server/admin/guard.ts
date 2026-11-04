import type { AdminRole } from "@/lib/admin-types";
import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";

/**
 * Admin authorization. Every admin service function takes an AdminContext,
 * and the only way to get one is requireAdmin(), which checks the
 * *verified* session user against platform_admins in the database. Roles
 * are never read from the browser, a cookie or JWT custom claims.
 *
 * - Not signed in                    → 401
 * - Signed in but not an admin       → 404 (the admin area doesn't reveal it exists)
 * - support role attempting a write  → 403
 * - Revoked admin or disabled account → treated as not an admin
 */
export interface AdminContext {
  readonly userId: string;
  readonly email: string | null;
  readonly role: AdminRole;
  /** Request metadata for the audit log. */
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export type AdminAccess = "read" | "write";

export const notAdmin = () => new DomainError("not_found", "Page not found.", 404);

export async function lookupAdminRole(db: Db, userId: string): Promise<AdminRole | null> {
  const rows = await db.query<{ role: AdminRole }>(
    `select a.role from public.platform_admins a join public.profiles p on p.id = a.user_id
      where a.user_id = $1 and a.revoked_at is null and p.disabled_at is null`,
    [userId],
  );
  return rows[0]?.role ?? null;
}

export async function requireAdmin(
  db: Db,
  user: { id: string; email: string | null } | null,
  access: AdminAccess,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<AdminContext> {
  if (!user) throw new DomainError("unauthenticated", "Please sign in.", 401);
  const role = await lookupAdminRole(db, user.id);
  if (!role) throw notAdmin();
  if (access === "write" && role !== "admin") {
    throw new DomainError("forbidden", "Your admin role is read-only.", 403);
  }
  return Object.freeze({ userId: user.id, email: user.email, role, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
}

/** Guards a write inside a service function, in case a read context is passed by mistake. */
export function assertWrite(ctx: AdminContext) {
  if (ctx.role !== "admin") throw new DomainError("forbidden", "Your admin role is read-only.", 403);
}

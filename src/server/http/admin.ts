import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { adminDeps } from "@/server/admin/deps";
import type { AdminDeps } from "@/server/admin/deps-types";
import { requireAdmin, type AdminAccess, type AdminContext } from "@/server/admin/guard";
import { getSessionUser } from "@/server/auth/session";
import { DomainError, domainErrors } from "@/server/generation/domain-error";

import { errorResponse, json } from "./respond";

const clientIp = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

/**
 * Wraps an admin API route. Authorization happens here on the server for
 * every request: verified session → platform_admins lookup → role check.
 * Hiding buttons in the UI is a convenience, never the protection.
 */
export function withAdmin<Ctx>(
  access: AdminAccess,
  handler: (req: Request, admin: AdminContext, deps: AdminDeps, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (!origin || origin !== new URL(req.url).origin) throw domainErrors.forbidden();
      }
      const user = await getSessionUser();
      const deps = adminDeps();
      const admin = await requireAdmin(deps.db, user, access, { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") });
      const res = await handler(req, admin, deps, ctx);
      res.headers.set("X-Robots-Tag", "noindex");
      return res;
    } catch (err) {
      if (err instanceof DomainError) return errorResponse(err.code, err.message, err.status);
      if (err instanceof z.ZodError) return errorResponse("invalid_request", err.issues[0]?.message ?? "Invalid request.", 400);
      console.error(JSON.stringify({ event: "admin_api.unhandled_error", url: req.url, error: String(err) }));
      return errorResponse("internal_error", "Something went wrong. Please try again.", 500);
    }
  };
}

/**
 * For admin server components: redirects signed-out visitors to sign in,
 * and answers 404 to everyone who isn't an admin.
 */
export async function adminPage(next = "/admin"): Promise<{ admin: AdminContext; deps: AdminDeps }> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const deps = adminDeps();
  const h = await headers();
  try {
    const admin = await requireAdmin(deps.db, user, "read", { ip: clientIp(h), userAgent: h.get("user-agent") });
    return { admin, deps };
  } catch (err) {
    if (err instanceof DomainError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}

export { json };

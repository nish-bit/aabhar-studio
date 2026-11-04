import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { ApiErrorBody, ApiErrorCode } from "@/lib/api-types";
import { isAccountDisabled } from "@/server/auth/account-status";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { DomainError, domainErrors } from "@/server/generation/domain-error";

export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(code: ApiErrorCode, message: string, status: number) {
  return json<ApiErrorBody>({ error: { code, message } }, { status });
}

/**
 * Wraps a route handler: requires a verified user, checks the Origin on
 * mutations, maps DomainErrors to JSON, and hides internal errors.
 */
export function withUser<Ctx>(
  handler: (req: Request, user: SessionUser, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        // Browsers always send Origin on POST/PUT/PATCH/DELETE; a missing or foreign Origin is refused (CSRF).
        const origin = req.headers.get("origin");
        if (!origin || origin !== new URL(req.url).origin) throw domainErrors.forbidden();
      }
      const user = await getSessionUser();
      if (!user) throw domainErrors.unauthenticated();
      if (await isAccountDisabled(user.id)) throw domainErrors.accountDisabled();
      return await handler(req, user, ctx);
    } catch (err) {
      if (err instanceof DomainError) return errorResponse(err.code, err.message, err.status);
      if (err instanceof z.ZodError) {
        return errorResponse("invalid_request", err.issues[0]?.message ?? "Invalid request.", 400);
      }
      console.error(JSON.stringify({ event: "api.unhandled_error", url: req.url, error: String(err) }));
      return errorResponse("internal_error", "Something went wrong. Please try again.", 500);
    }
  };
}

export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new DomainError("invalid_request", "Request body too large.", 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("invalid_request", "Request body must be JSON.", 400);
  }
}

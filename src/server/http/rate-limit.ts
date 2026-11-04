import "server-only";

import { database } from "@/server/db/postgres";
import { DomainError } from "@/server/generation/domain-error";

/**
 * Per-user limits for expensive or externally billed endpoints. Counted
 * atomically in Postgres (fixed windows), so they hold across serverless
 * instances. Generation and uploads have their own limits in the job SQL
 * and upload service.
 */
export const RATE_LIMITS = {
  cataloguePreview: { limit: 60, windowSeconds: 3600 },
  catalogueExport: { limit: 20, windowSeconds: 3600 },
  logoUpload: { limit: 20, windowSeconds: 3600 },
  checkoutCreate: { limit: 20, windowSeconds: 3600 },
  checkoutVerify: { limit: 60, windowSeconds: 3600 },
  receipt: { limit: 60, windowSeconds: 3600 },
  supportTicket: { limit: 10, windowSeconds: 3600 },
  refundRequest: { limit: 10, windowSeconds: 3600 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export async function enforceRateLimit(name: RateLimitName, subject: string): Promise<void> {
  const db = database();
  if (!db) return; // integration-ready mode: nothing expensive can run without the database anyway
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const rows = await db.query<{ ok: boolean }>(`select public.consume_rate_limit($1, $2, $3) as ok`, [`${name}:${subject}`, limit, windowSeconds]);
  if (!rows[0]?.ok) {
    throw new DomainError("rate_limited", `You've done this ${limit} times in the last hour. Please try again later.`, 429);
  }
}

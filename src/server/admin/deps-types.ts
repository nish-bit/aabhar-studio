import type { Db } from "@/server/db/sql";

/** Everything the admin services need. Production wiring lives in ./deps.ts. */
export interface AdminDeps {
  db: Db;
  /** Best-effort sign-in ban in Supabase Auth (the database flag is what's enforced). */
  authAdmin?: { setBanned(userId: string, banned: boolean): Promise<void> } | null;
  /** Starts a queued generation job: a Cloudflare Queue on Workers, after() elsewhere. */
  startJob?: ((jobId: string) => void | Promise<void>) | null;
  providerConfigured: boolean;
  /** Provider id/model used for admin retries. */
  provider?: { id: string; model: string } | null;
  billingMode: "test" | "live" | null;
  /** Refreshes cached public pricing after a plan change. */
  revalidatePlans?: () => void;
  now?: () => Date;
}

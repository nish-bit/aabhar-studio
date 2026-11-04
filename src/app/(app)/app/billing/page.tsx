import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BillingDashboard } from "@/components/billing/billing-dashboard";
import { ReferralCard } from "@/components/billing/referral-card";
import { RefundRequestsPanel } from "@/components/billing/refund-requests-panel";
import { SupportTicketsPanel } from "@/components/billing/support-tickets-panel";
import { loginPathFor } from "@/lib/auth-flow";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { getSessionUser } from "@/server/auth/session";
import { billingDeps } from "@/server/billing/deps";
import { getBillingOverview } from "@/server/billing/service";
import { dashboardDeps } from "@/server/dashboard/deps";
import { database } from "@/server/db/postgres";
import { getReferralSummary } from "@/server/referrals/service";
import { listMyRefundRequests, listRefundableImages, REFUND_WINDOW_DAYS } from "@/server/support/refund-requests";
import { listMyTickets } from "@/server/support/tickets";
import { integrationStatus } from "@/server/env";

export const metadata = { title: "Plans" };

type Search = Promise<{ plan?: string | string[]; pack?: string | string[] }>;

export default function BillingPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div className="mb-8 max-w-2xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">Plans</h1>
        <p className="mt-2 text-body text-ink-600">Buy credits and manage your billing.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-surface-sunken" aria-busy="true" aria-label="Loading billing" />}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Gate({ searchParams }: { searchParams: Search }) {
  await connection();

  const status = integrationStatus();
  if (!status.supabase || !status.database) {
    return (
      <IntegrationNotice title="Billing not connected">
        Set <code>DATABASE_URL</code> and the Supabase keys, apply the migrations, then add the Razorpay test keys. See{" "}
        <code>docs/BILLING.md</code>.
      </IntegrationNotice>
    );
  }
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  if (!user) {
    // Keep a plan or pack picked on /pricing through sign-in (the proxy normally handles this first).
    const q = new URLSearchParams();
    if (one(sp.plan)) q.set("plan", one(sp.plan)!);
    if (one(sp.pack)) q.set("pack", one(sp.pack)!);
    redirect(loginPathFor("/app/billing", q.size ? `?${q}` : ""));
  }
  const db = database();
  const deps = dashboardDeps();
  const [overview, referral, refunds, tickets] = await Promise.all([
    getBillingOverview(billingDeps(), user.id),
    db ? optional(getReferralSummary(db, user.id)) : null,
    deps ? optional(Promise.all([listMyRefundRequests(deps, user.id), listRefundableImages(deps, user.id)])) : null,
    db ? optional(listMyTickets(db, user.id)) : null,
  ]);
  const h = await headers();
  // The invite link uses the address this page was opened on (the user's own request).
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https")}://${host}`;
  return (
    <BillingDashboard initial={overview} focusPackId={one(sp.pack)}>
      {referral ? <ReferralCard summary={referral} origin={origin} /> : <NotReady title="Invites" />}
      {refunds ? (
        <RefundRequestsPanel initialRequests={refunds[0]} initialImages={refunds[1]} windowDays={REFUND_WINDOW_DAYS} />
      ) : (
        <NotReady title="Refunds" />
      )}
      {tickets ? <SupportTicketsPanel initialTickets={tickets} email={user.email} /> : <NotReady title="Help & Support" />}
    </BillingDashboard>
  );
}

/**
 * These sections need migration 20261103000400. Until it's applied the rest
 * of the page (plans, checkout, history) still works; the section says why
 * it's missing. Any other error is still thrown.
 */
async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "42P01") {
      console.error(JSON.stringify({ event: "billing.extras_schema_missing" }));
      return null;
    }
    throw err;
  }
}

function NotReady({ title }: { title: string }) {
  return (
    <IntegrationNotice title={`${title} not set up yet`}>
      Apply the pending migrations in <code>supabase/migrations</code> (<code>npx supabase db push</code>), then reload this page.
    </IntegrationNotice>
  );
}

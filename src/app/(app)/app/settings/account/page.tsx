import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, LogOut, Mail } from "lucide-react";

import { FreeTrialStatus } from "@/components/billing/free-trial-status";
import { MarketingPreferencesForm } from "@/components/settings/marketing-preferences-form";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { planLabel, refundMailto, SUPPORT_EMAIL } from "@/lib/billing-history";
import type { PaymentView } from "@/lib/billing-types";
import { formatCount, formatPaise } from "@/lib/format";
import { getSessionUser } from "@/server/auth/session";
import { billingDeps } from "@/server/billing/deps";
import { getBillingOverview } from "@/server/billing/service";
import { database } from "@/server/db/postgres";
import { integrationStatus } from "@/server/env";
import { getPreferences, isMarketingSchemaMissing } from "@/server/marketing/consent";

export const metadata = { title: "Settings" };

const STATUS: Record<PaymentView["status"], { tone: "success" | "warning" | "error" | "neutral"; label: string }> = {
  created: { tone: "neutral", label: "Started" },
  authorized: { tone: "warning", label: "Confirming" },
  captured: { tone: "success", label: "Paid" },
  failed: { tone: "error", label: "Failed" },
  refunded: { tone: "neutral", label: "Refunded" },
  partially_refunded: { tone: "warning", label: "Partly refunded" },
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default function SettingsPage() {
  return (
    <>
      <div className="mb-8 max-w-3xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">Settings</h1>
        <p className="mt-2 text-body text-ink-600">Account details, billing history, and refunds.</p>
      </div>
      <Suspense fallback={<SettingsSkeleton />}>
        <Gate />
      </Suspense>
    </>
  );
}

async function Gate() {
  const status = integrationStatus();
  const db = database();
  if (!status.supabase || !status.database || !db) {
    return (
      <IntegrationNotice title="Settings not connected">
        Set <code>DATABASE_URL</code> along with the Supabase keys, and apply the migrations in <code>supabase/migrations</code>.
      </IntegrationNotice>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/settings/account");

  // Each part fails on its own, so one problem doesn't hide the rest of the page.
  const [billing, prefs] = await Promise.all([
    getBillingOverview(billingDeps(), user.id).catch((err: unknown) => {
      console.error(JSON.stringify({ event: "settings.billing_failed", error: String(err).slice(0, 200) }));
      return null;
    }),
    getPreferences(db, user.id).catch((err: unknown) => {
      if (!isMarketingSchemaMissing(err)) throw err;
      return null;
    }),
  ]);
  const email = user.email;

  return (
    <div className="max-w-3xl space-y-8">
      {/* --------------------------------------------------------- account info */}
      <section aria-labelledby="account-title" className="rounded-md border border-ink-200 bg-surface p-5 sm:p-6">
        <h2 id="account-title" className="font-serif text-display-sm text-ink-900">
          Account Info
        </h2>
        <p className="mt-1 text-body-sm text-ink-600">Your login details and account identity.</p>
        <dl className="mt-5 divide-y divide-ink-100 border-t border-ink-100">
          <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
            <dt className="text-body-sm font-medium text-ink-700">Email address</dt>
            <dd>
              <p className="break-words text-body font-medium text-ink-900">{email ?? "—"}</p>
              <p className="mt-1 text-body-sm text-ink-600">
                Aabhar Studio has no password: you sign in with Google. To use a different email, sign in with that Google account.
              </p>
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
            <dt className="text-body-sm font-medium text-ink-700">Credits remaining</dt>
            <dd>
              <p className="font-serif text-display-sm font-semibold tabular text-ink-900">{billing ? formatCount(billing.balance) : "—"}</p>
              <p className="mt-1 text-body-sm text-ink-600">
                Each credit makes one jewellery photo in the essential styles; Velvet, Marble and Editorial use 2.
              </p>
              <Link href="/app/billing" className="mt-2 inline-flex items-center gap-1 text-body-sm font-medium text-gold-700 underline-offset-4 hover:underline">
                Buy more credits <ArrowRight className="size-4" aria-hidden />
              </Link>
              {billing && <FreeTrialStatus trial={billing.freeTrial} balance={billing.balance} className="mt-3" />}
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
            <dt className="text-body-sm font-medium text-ink-700">Sign out</dt>
            <dd>
              <form action="/auth/sign-out" method="post">
                <Button type="submit" variant="secondary" size="sm">
                  <LogOut aria-hidden />
                  Sign out
                </Button>
              </form>
            </dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------------------------------ billing history */}
      <section aria-labelledby="history-title" className="space-y-3">
        <div>
          <h2 id="history-title" className="font-serif text-display-sm text-ink-900">
            Billing History
          </h2>
          <p className="mt-1 text-body-sm text-ink-600">All your past purchases and credit top-ups.</p>
        </div>
        {!billing ? (
          <Alert tone="error" title="Billing history isn't available right now">
            Please reload the page in a moment. Your purchases and credits are not affected.
          </Alert>
        ) : billing.payments.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-ink-300 bg-surface p-6">
            <p className="text-heading-sm font-semibold text-ink-900">No transactions yet.</p>
            <Link href="/app/billing" className="inline-flex items-center gap-1 text-body-sm font-medium text-gold-700 underline-offset-4 hover:underline">
              View Plans <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-ink-200 bg-surface" role="region" aria-labelledby="history-title" tabIndex={0}>
            <table className="w-full min-w-[520px] text-body-sm">
              <caption className="sr-only">Your payments, newest first</caption>
              <thead className="bg-surface-sunken text-left text-caption uppercase tracking-[0.06em] text-ink-600">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Plan</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {billing.payments.map((p) => (
                  <tr key={p.id} className="border-t border-ink-100">
                    <td className="whitespace-nowrap px-4 py-3 tabular text-ink-700">{date(p.createdAt)}</td>
                    <td className="px-4 py-3 text-ink-900">
                      {planLabel(p.description)}
                      {p.creditsGranted > 0 && <span className="block text-caption text-ink-500">{formatCount(p.creditsGranted)} credits</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular text-ink-900">
                      {formatPaise(p.amountPaise)}
                      {p.amountRefundedPaise > 0 && <span className="block text-caption text-ink-500">{formatPaise(p.amountRefundedPaise)} refunded</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------- refunds */}
      <section aria-labelledby="refunds-title" className="rounded-md border border-gold-200 bg-gold-50 p-5 sm:p-6">
        <h2 id="refunds-title" className="font-serif text-display-sm text-ink-900">
          Refunds
        </h2>
        <p className="mt-1 text-body-sm font-medium text-ink-800">Not satisfied? We offer a 100% refund.</p>
        <p className="mt-3 text-body-sm text-ink-700">
          If you are not satisfied with the quality of your generated photos, we will refund your purchase in full — no questions asked.
        </p>
        <p className="mt-2 text-body-sm text-ink-700">
          Simply reach out within 7 days of purchase with your order details and we will process your refund promptly.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href={refundMailto(email)}>
              <Mail aria-hidden />
              Request a Refund
            </a>
          </Button>
          <span className="text-caption text-ink-600">
            Opens your email app, addressed to {SUPPORT_EMAIL}. Only some photos fell short?{" "}
            <Link href="/app/billing#refunds-title" className="text-gold-700 underline underline-offset-2">
              Point at them on the Plans page
            </Link>
            .
          </span>
        </div>
      </section>

      {/* ------------------------------------------------- marketing preferences */}
      <section aria-labelledby="marketing-title" className="rounded-md border border-ink-200 bg-surface p-5 sm:p-6">
        <h2 id="marketing-title" className="text-heading-sm font-semibold text-ink-900">
          Marketing preferences
        </h2>
        <div className="mt-3">
          {prefs ? (
            <MarketingPreferencesForm initial={prefs} />
          ) : (
            <p className="text-body-sm text-ink-600">Email preferences will appear here once the pending database migrations are applied.</p>
          )}
        </div>
      </section>

      <p className="text-body-sm text-ink-600">
        Catalogue logo and contact details are under{" "}
        <Link href="/app/settings/business" className="text-gold-700 underline underline-offset-2">
          Business details
        </Link>
        .
      </p>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="max-w-3xl space-y-8" aria-busy="true" aria-label="Loading settings">
      <div className="h-72 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-48 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-40 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}

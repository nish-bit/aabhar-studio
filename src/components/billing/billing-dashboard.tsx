"use client";

import { useEffect, useId, useState } from "react";
import { CheckCircle2, Clock, Download, Loader2, XCircle } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FreeTrialStatus } from "@/components/billing/free-trial-status";
import { PackPlans, packTitle } from "@/components/marketing/pack-plans";
import { billingConfig } from "@/config/billing";
import { pricingPacks } from "@/config/plans";
import { billingApi } from "@/features/billing/api-client";
import { useBilling, type CheckoutPhase } from "@/features/billing/use-billing";
import type { BillingOverview, CreditGrantView, EntitlementView, PaymentView, SubscriptionView } from "@/lib/billing-types";
import { formatCount, formatPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

const SOURCE_LABEL: Record<CreditGrantView["source"], string> = {
  trial: "Free trial",
  plan: "Plan credits",
  pack: "Credit pack",
  admin: "Added by support",
  refund_restore: "Returned credits",
  legacy: "Earlier credits",
  referral: "Referral reward",
  refund_request: "Refund request",
};

const STATE_BADGE: Record<EntitlementView["state"], { tone: "success" | "warning" | "error" | "neutral" | "gold"; label: string }> = {
  trial: { tone: "gold", label: "Free trial" },
  pack: { tone: "success", label: "Credit packs" },
  subscribed: { tone: "success", label: "Active" },
  grace: { tone: "warning", label: "Ends soon" },
  past_due: { tone: "error", label: "Payment overdue" },
  lapsed: { tone: "neutral", label: "Not active" },
};

const PAYMENT_STATUS: Record<PaymentView["status"], { tone: "success" | "warning" | "error" | "neutral"; label: string }> = {
  created: { tone: "neutral", label: "Started" },
  authorized: { tone: "warning", label: "Confirming" },
  captured: { tone: "success", label: "Paid" },
  failed: { tone: "error", label: "Failed" },
  refunded: { tone: "neutral", label: "Refunded" },
  partially_refunded: { tone: "warning", label: "Partly refunded" },
};

export interface BillingDashboardProps {
  initial: BillingOverview;
  /** From ?pack= links on the pricing page: highlighted, never auto-charged. */
  focusPackId?: string | null;
  /** Extra sections (invite, refunds, support), shown above the payment history. */
  children?: React.ReactNode;
}

export function BillingDashboard({ initial, focusPackId, children }: BillingDashboardProps) {
  const b = useBilling(initial);
  const { overview } = b;
  const enabled = overview.availability.enabled;
  const canPay = enabled && overview.canManage;
  const sub = overview.subscription;
  const packs = pricingPacks.filter((p) => !p.firstPurchaseOnly || overview.firstPurchaseAvailable);
  const focusedPack = packs.find((p) => p.id === focusPackId) ?? null;
  const starterGone = !overview.firstPurchaseAvailable && billingConfig.packs.some((p) => p.id === focusPackId && p.firstPurchaseOnly);

  // Bring the pack picked on /pricing into view. It is only highlighted, never charged automatically.
  useEffect(() => {
    if (!focusedPack) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`pack-${focusedPack.id}`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [focusedPack]);

  return (
    <div className="space-y-10">
      {overview.availability.mode === "test" && enabled && (
        <Alert tone="warning" title="Test mode">
          Payments use Razorpay test keys. No real money moves. Use Razorpay&apos;s test cards or UPI IDs.
        </Alert>
      )}
      {!enabled && (
        <Alert tone="neutral" title="Payments aren't available yet">
          {overview.availability.reason}
        </Alert>
      )}
      {enabled && !overview.canManage && (
        <Alert tone="info" title="Only the shop owner can make payments">
          You can see the credits and limits, but purchases are made by the owner.
        </Alert>
      )}

      {canPay && b.checkout.phase === "idle" && focusedPack && (
        <Alert tone="info" title={`You picked the ${packTitle(focusedPack)}`}>
          It&apos;s highlighted below. Tap Buy to review and pay in Razorpay. Nothing is charged until you confirm there.
        </Alert>
      )}
      {starterGone && (
        <Alert tone="info" title="The Starter Pack is for first purchases">
          You&apos;ve already bought credits, so choose one of the plans below.
        </Alert>
      )}
      <CheckoutStatus state={b.checkout} onDismiss={b.dismissCheckout} />
      {b.notice && (
        <Alert tone={b.notice.tone === "error" ? "error" : b.notice.tone === "success" ? "success" : "info"} live={b.notice.tone === "error" ? "assertive" : "polite"}>
          {b.notice.text}
        </Alert>
      )}

      <FreeTrialStatus trial={overview.freeTrial} balance={overview.balance} />

      <section aria-labelledby="choose-title" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="choose-title" className="font-serif text-display-sm text-ink-900">
              Choose a plan
            </h2>
            <p className="mt-1 text-body-sm text-ink-600">
              Each credit makes one image in the essential styles (premium styles use 2). Buy once, use any time within 12 months.
            </p>
          </div>
          <p className="shrink-0 rounded-full border border-gold-200 bg-gold-50 px-4 py-1.5 text-body-sm text-ink-800">
            Available: <strong className="tabular text-ink-900">{formatCount(overview.balance)}</strong> {overview.balance === 1 ? "credit" : "credits"}
          </p>
        </div>
        <PackPlans
          packs={packs}
          action={(pack) => (
            <Button
              size="lg"
              variant={pack.featured || pack.id === focusedPack?.id ? "primary" : "secondary"}
              className={cn("w-full", pack.id === focusedPack?.id && "ring-2 ring-gold-300")}
              id={`pack-${pack.id}`}
              disabled={!canPay || b.busy}
              onClick={() => b.buyPack(pack.id, packTitle(pack))}
            >
              Buy {packTitle(pack)}
            </Button>
          )}
        />
        <p className="text-caption text-ink-600">
          {billingConfig.pricesApproved ? null : "Indicative pricing. "}Prices {billingConfig.gst.pricesIncludeGst ? "include" : "exclude"}{" "}
          {billingConfig.gst.ratePercent}% GST. Paid securely through Razorpay; credits are added only after Razorpay confirms the payment.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <PlanCard entitlement={overview.entitlement} subscription={sub} canManage={canPay} busy={b.busy} onCancel={b.cancel} />
        <CreditsCard balance={overview.balance} grants={overview.grants} />
      </div>

      {children}

      <PaymentHistory payments={overview.payments} />
      <LedgerTable entries={overview.ledger} />
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function CheckoutStatus({ state, onDismiss }: { state: CheckoutPhase; onDismiss: () => void }) {
  if (state.phase === "idle") return <div role="status" aria-live="polite" className="sr-only" />;
  const working = state.phase === "starting" || state.phase === "open" || state.phase === "verifying";
  const text =
    state.phase === "starting"
      ? `${state.label}: preparing secure checkout…`
      : state.phase === "open"
        ? `${state.label}: complete the payment in the Razorpay window.`
        : state.phase === "verifying"
          ? "Confirming your payment with Razorpay… Please don't close this page."
          : state.message;
  const tone =
    state.phase === "success" ? "border-success-border bg-success-bg" : state.phase === "failed" ? "border-error-border bg-error-bg" : "border-ink-200 bg-surface";
  const Icon = working ? Loader2 : state.phase === "success" ? CheckCircle2 : state.phase === "failed" ? XCircle : Clock;
  return (
    <div role={state.phase === "failed" ? "alert" : "status"} aria-live={state.phase === "failed" ? "assertive" : "polite"} className={cn("flex items-start gap-3 rounded-md border p-4", tone)}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", working && "motion-safe:animate-spin")} aria-hidden />
      <p className="flex-1 text-body-sm text-ink-900">{text}</p>
      {!working && (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}

function PlanCard(props: {
  entitlement: EntitlementView;
  subscription: SubscriptionView | null;
  canManage: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const { entitlement: e, subscription: s } = props;
  const badge = STATE_BADGE[e.state];
  const [open, setOpen] = useState(false);
  const descId = useId();
  const cancellable = s && ["active", "authenticated", "pending"].includes(s.status) && !s.cancelAtCycleEnd;

  return (
    <section aria-labelledby="plan-title" className="rounded-md border border-ink-200 bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-overline uppercase tracking-[0.12em] text-ink-600">Your access</p>
          <h2 id="plan-title" className="mt-1 font-serif text-display-sm text-ink-900">
            {e.planName}
          </h2>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-body-sm">
        {s && (
          <>
            <dt className="text-ink-600">{s.cancelAtCycleEnd || e.state === "grace" ? "Ends on" : "Renews on"}</dt>
            <dd className="tabular text-ink-900">{date(s.currentEnd)}</dd>
            <dt className="text-ink-600">Price</dt>
            <dd className="tabular text-ink-900">{formatPaise(s.amountPaise)} / month</dd>
          </>
        )}
        <dt className="text-ink-600">Running at once</dt>
        <dd className="tabular text-ink-900">{e.limits.maxActiveJobs}</dd>
        <dt className="text-ink-600">Per day</dt>
        <dd className="tabular text-ink-900">{formatCount(e.limits.dailyGenerations)} generations</dd>
        <dt className="text-ink-600">Catalogues</dt>
        <dd className="tabular text-ink-900">
          {e.limits.maxCatalogues} × {e.limits.maxCatalogueItems} products
        </dd>
        <dt className="text-ink-600">Styles</dt>
        <dd className="text-ink-900">{e.limits.presets === "all" ? "All" : `${e.limits.presets.length} essential`}</dd>
      </dl>

      {e.state === "past_due" && s?.status === "pending" && (
        <Alert tone="warning" className="mt-5" title="Renewal payment failed">
          Razorpay will retry automatically. Your plan keeps working meanwhile. Check your card or UPI mandate has funds and is active.
        </Alert>
      )}
      {e.state === "past_due" && s?.status === "halted" && (
        <Alert tone="error" className="mt-5" title="Plan paused after failed payments">
          Your remaining credits still work, with basic limits. Buying any credit pack below restores full access.
        </Alert>
      )}
      {s?.cancelAtCycleEnd && e.state !== "lapsed" && (
        <p className="mt-5 text-body-sm text-ink-700">Cancelled — won&apos;t renew. Your plan works until {date(s.currentEnd)}.</p>
      )}
      {s?.mode === "test" && <p className="mt-3 text-caption text-warning-fg">Test-mode subscription</p>}
      {e.state === "trial" && (
        <p className="mt-5 text-body-sm text-ink-700">
          Buy any credit pack to unlock all six styles, {billingConfig.packLimits.maxCatalogues} catalogues and up to{" "}
          {formatCount(billingConfig.packLimits.dailyGenerations)} images a day.
        </p>
      )}

      {cancellable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <Button variant="ghost" className="mt-5 px-0 text-ink-700" disabled={!props.canManage || props.busy} onClick={() => setOpen(true)}>
            Cancel subscription
          </Button>
          <DialogContent aria-describedby={descId}>
            <DialogHeader>
              <DialogTitle>Cancel your {e.planName} plan?</DialogTitle>
              <DialogDescription id={descId}>
                You won&apos;t be charged again. Your plan and this month&apos;s credits keep working until {date(s.currentEnd)}. Credit pack credits
                stay until they expire.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Keep plan</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  setOpen(false);
                  props.onCancel();
                }}
              >
                Cancel at period end
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function CreditsCard({ balance, grants }: { balance: number; grants: CreditGrantView[] }) {
  return (
    <section aria-labelledby="credits-title" className="rounded-md border border-ink-200 bg-surface p-6">
      <p className="text-overline uppercase tracking-[0.12em] text-ink-600">Credits</p>
      <h2 id="credits-title" className="mt-1 font-serif text-display-sm text-ink-900">
        <span className="tabular">{formatCount(balance)}</span> available
      </h2>
      {grants.length === 0 ? (
        <p className="mt-5 text-body-sm text-ink-600">No credits right now. Subscribe or buy a pack to keep creating.</p>
      ) : (
        <table className="mt-5 w-full text-body-sm">
          <caption className="sr-only">Your credits by source, soonest to expire first. These are used in this order.</caption>
          <thead>
            <tr className="text-left text-ink-600">
              <th scope="col" className="pb-2 font-medium">
                Source
              </th>
              <th scope="col" className="pb-2 font-medium">
                Left
              </th>
              <th scope="col" className="pb-2 font-medium">
                Expires
              </th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} className="border-t border-ink-100">
                <td className="py-2 text-ink-900">{SOURCE_LABEL[g.source]}</td>
                <td className="py-2 tabular text-ink-900">
                  {g.remaining} <span className="text-ink-500">/ {g.amount}</span>
                </td>
                <td className="py-2 tabular text-ink-700">{g.expiresAt ? date(g.expiresAt) : "Doesn't expire"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-caption text-ink-600">Credits that expire soonest are used first.</p>
    </section>
  );
}

function PaymentHistory({ payments }: { payments: PaymentView[] }) {
  return (
    <section aria-labelledby="history-title" className="space-y-4">
      <h2 id="history-title" className="font-serif text-display-sm text-ink-900">
        Billing history
      </h2>
      {payments.length === 0 ? (
        <p className="text-body-sm text-ink-600">No payments yet.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border border-ink-200 bg-surface" role="region" aria-labelledby="history-title" tabIndex={0}>
          <table className="w-full min-w-[640px] text-body-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-ink-600">
                <th scope="col" className="p-3 font-medium">Date</th>
                <th scope="col" className="p-3 font-medium">Description</th>
                <th scope="col" className="p-3 font-medium">Amount</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">
                  <span className="sr-only">Receipt</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const st = PAYMENT_STATUS[p.status];
                return (
                  <tr key={p.id} className="border-b border-ink-100 last:border-0 align-top">
                    <td className="p-3 tabular text-ink-700">{date(p.createdAt)}</td>
                    <td className="p-3 text-ink-900">
                      {p.description}
                      {p.creditsGranted > 0 && <span className="block text-caption text-ink-600">{p.creditsGranted} credits</span>}
                      {p.status === "failed" && p.errorDescription && <span className="block text-caption text-error-fg">{p.errorDescription}</span>}
                    </td>
                    <td className="p-3 tabular text-ink-900">
                      {formatPaise(p.amountPaise)}
                      {p.amountRefundedPaise > 0 && <span className="block text-caption text-ink-600">{formatPaise(p.amountRefundedPaise)} refunded</span>}
                    </td>
                    <td className="p-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      {p.receiptAvailable && (
                        <a
                          href={billingApi.receiptUrl(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-sm text-gold-700 underline-offset-4 hover:underline focus-visible:outline-2"
                        >
                          <Download className="size-4" aria-hidden />
                          Receipt<span className="sr-only"> for {p.description}</span>
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const LEDGER_LABEL = { grant: "Added", debit: "Used", refund: "Returned", adjustment: "Adjusted", expiry: "Expired" } as const;

function LedgerTable({ entries }: { entries: BillingOverview["ledger"] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="ledger-title" className="space-y-4">
      <h2 id="ledger-title" className="font-serif text-display-sm text-ink-900">
        Credit activity
      </h2>
      <div className="relative overflow-x-auto rounded-md border border-ink-200 bg-surface" role="region" aria-labelledby="ledger-title" tabIndex={0}>
        <table className="w-full min-w-[520px] text-body-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-ink-600">
              <th scope="col" className="p-3 font-medium">Date</th>
              <th scope="col" className="p-3 font-medium">What</th>
              <th scope="col" className="p-3 font-medium">Change</th>
              <th scope="col" className="p-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((l) => (
              <tr key={l.id} className="border-b border-ink-100 last:border-0">
                <td className="p-3 tabular text-ink-700">{date(l.createdAt)}</td>
                <td className="p-3 text-ink-900">
                  {LEDGER_LABEL[l.type]}
                  {l.reason ? <span className="text-ink-600"> · {l.reason}</span> : null}
                </td>
                <td className={cn("p-3 tabular", l.amount > 0 ? "text-success-fg" : "text-ink-900")}>
                  {l.amount > 0 ? `+${l.amount}` : `−${Math.abs(l.amount)}`}
                </td>
                <td className="p-3 tabular text-ink-700">{l.balanceAfter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

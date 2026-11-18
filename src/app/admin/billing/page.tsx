import type { ReactNode } from "react";
import Link from "next/link";

import { fmtDate, fmtDateTime, fmtInr } from "@/components/admin/format";
import {
  AdminPageHeader,
  DataTable,
  EmptyState,
  Facts,
  FilterBar,
  ModeBadge,
  Mono,
  Pagination,
  Section,
  Stat,
  StatGrid,
  StatusBadge,
  Th,
} from "@/components/admin/primitives";
import { one, parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { billingConfig, planById } from "@/config/billing";
import {
  getBillingHealth,
  listPayments,
  listSubscriptions,
  listWebhookEvents,
  paymentFilterSchema,
  subscriptionFilterSchema,
  webhookFilterSchema,
} from "@/server/admin/billing";
import { adminPage } from "@/server/http/admin";
import { cn } from "@/lib/utils";

export const metadata = { title: "Payments" };

const TABS = [
  { id: "health", label: "Health" },
  { id: "payments", label: "Payments" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "webhooks", label: "Webhook events" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const modeOptions = [{ value: "live", label: "Live" }, { value: "test", label: "Test" }];

export default async function AdminBilling({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/billing");
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === one(sp, "tab"))?.id ?? "payments") as Tab;

  return (
    <>
      <AdminPageHeader
        title="Payments"
        description="Payments, subscriptions and Razorpay webhook events. Card details are never stored; raw webhook payloads (which hold customer contact details) are not shown."
      />
      <nav aria-label="Payment views" className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-200">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/billing?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-body-sm",
              tab === t.id ? "border-ink-900 font-medium text-ink-900" : "border-transparent text-ink-600 hover:text-ink-900",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "health" && <Health deps={deps} admin={admin} />}
      {tab === "payments" && <Payments sp={sp} deps={deps} admin={admin} />}
      {tab === "subscriptions" && <Subscriptions sp={sp} deps={deps} admin={admin} />}
      {tab === "webhooks" && <Webhooks sp={sp} deps={deps} admin={admin} />}
    </>
  );
}

type P = { sp: RawSearchParams } & Awaited<ReturnType<typeof adminPage>>;

const yesNo = (v: boolean) => <StatusBadge status={v ? "active" : "failed"} label={v ? "Yes" : "No"} />;

async function Health({ deps, admin }: Omit<P, "sp">) {
  const h = await getBillingHealth(deps, admin);
  const run = h.lastReconcileRun;
  return (
    <div className="space-y-6">
      <Section title="Razorpay connection">
        <Facts
          items={[
            ["Payments enabled", yesNo(h.paymentsEnabled)],
            ["Mode", <ModeBadge key="mode" mode={h.mode} />],
            ["Webhook secret configured", yesNo(h.webhookSecretConfigured)],
            ["Checked", fmtDateTime(h.checkedAt)],
          ]}
        />
      </Section>
      <Section title="Webhooks">
        <StatGrid>
          <Stat
            label="Last processed"
            value={h.lastProcessedWebhook ? fmtDateTime(h.lastProcessedWebhook.processedAt) : "Never"}
            hint={h.lastProcessedWebhook ? `${h.lastProcessedWebhook.eventType} · ${h.lastProcessedWebhook.outcome ?? "processed"}` : "No event has been processed yet."}
          />
          <Stat label="Failing" value={h.webhooks.failed} tone={h.webhooks.failed > 0 ? "error" : undefined} hint="Last attempt errored; Razorpay retries." />
          <Stat label="Not processed yet" value={h.webhooks.pending} tone={h.webhooks.pending > 0 ? "warning" : undefined} hint={h.webhooks.oldestUnprocessedAt ? `Oldest received ${fmtDateTime(h.webhooks.oldestUnprocessedAt)}` : undefined} />
        </StatGrid>
      </Section>
      <Section title="Unpaid orders older than one hour">
        <StatGrid>
          <Stat label="Unpaid > 1 hour" value={h.unpaidOrders.olderThanOneHour} hint="Mostly abandoned checkouts." />
          <Stat label="Still being reconciled" value={h.unpaidOrders.withinReconcileWindow} hint="Created in the last 72 hours; checked with Razorpay hourly." />
        </StatGrid>
        {h.unpaidOrders.recent.length > 0 && (
          <DataTable label="Most recent unpaid orders" minWidth={640} head={<><Th>Created</Th><Th>Order</Th><Th>Pack</Th><Th>Amount</Th><Th>Mode</Th></>}>
            {h.unpaidOrders.recent.map((o) => (
              <tr key={o.razorpayOrderId}>
                <td className="tabular">{fmtDateTime(o.createdAt)}</td>
                <td><Mono>{o.razorpayOrderId}</Mono></td>
                <td>{o.packId}</td>
                <td className="tabular">{fmtInr(o.amountPaise)}</td>
                <td><ModeBadge mode={o.mode} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      <Section title="Last reconciliation run">
        {run === "unavailable" ? (
          <EmptyState title="Run history isn't available yet">Apply migration 20261115000100_billing_reconcile_runs.sql to record runs.</EmptyState>
        ) : run === null ? (
          <EmptyState title="No run recorded yet">The hourly billing cron (17 * * * *) records each run here.</EmptyState>
        ) : (
          <Facts
            items={[
              ["Finished", fmtDateTime(run.finishedAt)],
              ["Result", <StatusBadge key="r" status={run.ok ? "processed" : "failed"} label={run.ok ? "OK" : "Problems"} />],
              ["Expired credit lots", run.expiredGrants],
              ["Orders checked", run.ordersChecked],
              ["Orders confirmed", run.ordersConfirmed],
              ["Orders that couldn't be checked", run.ordersFailed],
              ...(run.error ? ([["Error", run.error]] as [string, ReactNode][]) : []),
            ]}
          />
        )}
      </Section>
    </div>
  );
}

async function Payments({ sp, deps, admin }: P) {
  const f = parseFilters(paymentFilterSchema, sp);
  const r = await listPayments(deps, admin, f);
  return (
    <>
      <FilterBar
        action="/admin/billing"
        hidden={{ tab: "payments" }}
        q={f.q}
        qPlaceholder="pay_… id, shop id or shop name"
        selects={[
          { name: "status", label: "Status", value: f.status, options: ["captured", "authorized", "failed", "refunded", "partially_refunded", "created"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
          { name: "kind", label: "Type", value: f.kind, options: [{ value: "subscription", label: "Subscription" }, { value: "pack", label: "Credit pack" }] },
          { name: "mode", label: "Mode", value: f.mode, options: modeOptions },
        ]}
      />
      {r.items.length === 0 ? (
        <EmptyState title="No payments match" />
      ) : (
        <DataTable label="Payments" minWidth={900} head={<><Th>Date</Th><Th>Shop</Th><Th>Description</Th><Th>Amount</Th><Th>Status</Th><Th>Method</Th><Th>Credits</Th><Th>Mode</Th><Th>Reference</Th></>}>
          {r.items.map((p) => (
            <tr key={p.id}>
              <td className="tabular">{fmtDateTime(p.createdAt)}</td>
              <td><Link className="underline" href={`/admin/users?q=${p.shopId}`}>{p.shopName}</Link></td>
              <td className="max-w-[240px]">{p.description}</td>
              <td className="tabular">{fmtInr(p.amountPaise)}{p.amountRefundedPaise > 0 && <span className="block text-caption">−{fmtInr(p.amountRefundedPaise)}</span>}</td>
              <td><StatusBadge status={p.status} />{p.errorCode && <span className="block text-caption text-error-fg">{p.errorCode}</span>}</td>
              <td>{p.method ?? "—"}</td>
              <td className="tabular">{p.creditsGranted || "—"}</td>
              <td><ModeBadge mode={p.mode} /></td>
              <td><Mono>{p.razorpayPaymentId}</Mono></td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/billing" params={{ tab: "payments", q: f.q, status: f.status, kind: f.kind, mode: f.mode }} page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}

async function Subscriptions({ sp, deps, admin }: P) {
  const f = parseFilters(subscriptionFilterSchema, sp);
  const r = await listSubscriptions(deps, admin, f);
  return (
    <>
      <FilterBar
        action="/admin/billing"
        hidden={{ tab: "subscriptions" }}
        q={f.q}
        qPlaceholder="sub_… id, shop id or shop name"
        selects={[
          { name: "status", label: "Status", value: f.status, options: ["active", "authenticated", "pending", "halted", "paused", "cancelled", "completed", "expired", "created"].map((s) => ({ value: s, label: s })) },
          { name: "plan", label: "Plan", value: f.plan, options: billingConfig.plans.filter((p) => p.monthlyPricePaise !== null).map((p) => ({ value: p.id, label: p.name })) },
          { name: "mode", label: "Mode", value: f.mode, options: modeOptions },
        ]}
      />
      {r.items.length === 0 ? (
        <EmptyState title="No subscriptions match" />
      ) : (
        <DataTable label="Subscriptions" minWidth={880} head={<><Th>Created</Th><Th>Shop</Th><Th>Plan</Th><Th>Status</Th><Th>Price</Th><Th>Period ends</Th><Th>Mode</Th><Th>Reference</Th></>}>
          {r.items.map((s) => (
            <tr key={s.id}>
              <td className="tabular">{fmtDate(s.createdAt)}</td>
              <td><Link className="underline" href={`/admin/users?q=${s.shopId}`}>{s.shopName}</Link></td>
              <td>
                {planById(s.planId)?.name ?? s.planId}
                {s.scheduledPlanId && <span className="block text-caption text-ink-500">→ {planById(s.scheduledPlanId)?.name ?? s.scheduledPlanId} at renewal</span>}
              </td>
              <td><StatusBadge status={s.status} />{s.cancelAtCycleEnd && <span className="block text-caption text-ink-500">won&apos;t renew</span>}</td>
              <td className="tabular">{fmtInr(s.amountPaise)}</td>
              <td className="tabular">{fmtDate(s.currentEnd)}</td>
              <td><ModeBadge mode={s.mode} /></td>
              <td><Mono>{s.razorpaySubscriptionId}</Mono></td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/billing" params={{ tab: "subscriptions", q: f.q, status: f.status, plan: f.plan, mode: f.mode }} page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}

async function Webhooks({ sp, deps, admin }: P) {
  const f = parseFilters(webhookFilterSchema, sp);
  const r = await listWebhookEvents(deps, admin, f);
  const types = ["payment.captured", "payment.failed", "order.paid", "subscription.charged", "subscription.activated", "subscription.pending", "subscription.halted", "subscription.cancelled", "refund.processed"];
  return (
    <>
      <FilterBar
        action="/admin/billing"
        hidden={{ tab: "webhooks" }}
        q={f.q}
        qPlaceholder="Event id, pay_… / sub_… / rfnd_… id"
        selects={[
          { name: "type", label: "Event", value: f.type, options: types.map((t) => ({ value: t, label: t })) },
          { name: "state", label: "State", value: f.state, options: [{ value: "processed", label: "Processed" }, { value: "failed", label: "Failing" }, { value: "pending", label: "Not processed" }] },
        ]}
      />
      {r.items.length === 0 ? (
        <EmptyState title="No webhook events match">Events appear once Razorpay delivers them to /api/webhooks/razorpay.</EmptyState>
      ) : (
        <DataTable label="Webhook events" minWidth={960} head={<><Th>Received</Th><Th>Event</Th><Th>Mode</Th><Th>Summary</Th><Th>Attempts</Th><Th>Outcome</Th></>}>
          {r.items.map((w) => (
            <tr key={w.eventId}>
              <td className="tabular">{fmtDateTime(w.receivedAt)}</td>
              <td>{w.type}<span className="block"><Mono>{w.eventId}</Mono></span></td>
              <td><ModeBadge mode={w.mode} /></td>
              <td className="text-caption">
                {[w.summary.paymentId, w.summary.subscriptionId, w.summary.refundId].filter(Boolean).map((x) => <Mono key={x!}>{x}</Mono>)}
                {w.summary.amountPaise != null && <span className="block">{fmtInr(w.summary.amountPaise)}</span>}
                {w.summary.status && <span className="block">{w.summary.status}</span>}
              </td>
              <td className="tabular">{w.attempts}</td>
              <td>
                {w.processedAt ? <StatusBadge status="processed" label={w.outcome ?? "processed"} /> : w.lastError ? <StatusBadge status="failed" label="failing" /> : <StatusBadge status="pending" label="not processed" />}
                {w.lastError && <span className="block max-w-[260px] break-words text-caption text-error-fg">{w.lastError}</span>}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/billing" params={{ tab: "webhooks", q: f.q, type: f.type, state: f.state }} page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}

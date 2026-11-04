import Link from "next/link";

import { fmtCount, fmtInr, fmtPct, fmtUsd } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, ModeBadge, Section, Stat, StatGrid, Th } from "@/components/admin/primitives";
import { planById } from "@/config/billing";
import { errorSummary } from "@/server/admin/jobs";
import { getMetrics } from "@/server/admin/metrics";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Overview" };

export default async function AdminOverview() {
  const { admin, deps } = await adminPage("/admin");
  const [m, errors] = await Promise.all([getMetrics(deps, admin), errorSummary(deps, admin)]);
  const successRate = m.jobs.total30d ? m.jobs.succeeded30d / m.jobs.total30d : null;
  const maxDay = Math.max(1, ...m.jobs.daily.map((d) => d.succeeded + d.failed));
  const failed7d = errors.failedByCode.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Overview" description="Aggregate numbers across all shops. Test-mode payments are always shown separately from live revenue." />

      <StatGrid>
        <Stat label="Users" value={fmtCount(m.users.total)} hint={`+${m.users.new7d} this week · +${m.users.new30d} in 30 days`} />
        <Stat label="Active shops (30 days)" value={fmtCount(m.users.activeShops30d)} hint="made at least one generation" />
        <Stat label="Generations (30 days)" value={fmtCount(m.jobs.total30d)} hint={`${fmtPct(successRate)} succeeded`} />
        <Stat label="Provider cost (30 days)" value={fmtUsd(m.jobs.costUsdMicros30d)} hint={m.jobs.succeeded30d ? `${fmtUsd(m.jobs.costUsdMicros30d / m.jobs.succeeded30d)} per success` : "estimated from usage"} />
        <Stat label="Failed jobs (7 days)" value={fmtCount(failed7d)} tone={failed7d > 0 ? "warning" : undefined} hint={<Link className="underline" href="/admin/errors">Review errors</Link>} />
        <Stat label="Disabled accounts" value={fmtCount(m.users.disabled)} />
      </StatGrid>

      {(errors.stuckJobs > 0 || errors.queuedOver10m > 0 || errors.webhookFailures.length > 0) && (
        <div role="status" className="rounded-md border border-warning-border bg-warning-bg p-4 text-body-sm text-ink-800">
          <p className="font-semibold text-warning-fg">Needs attention</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.stuckJobs > 0 && <li>{errors.stuckJobs} job(s) stuck in processing past their lease (the watchdog cron refunds these).</li>}
            {errors.queuedOver10m > 0 && <li>{errors.queuedOver10m} job(s) queued for more than 10 minutes.</li>}
            {errors.webhookFailures.length > 0 && <li>{errors.webhookFailures.length} payment webhook(s) failing or unprocessed.</li>}
          </ul>
          <Link href="/admin/errors" className="mt-2 inline-block font-medium underline">
            Open the errors page
          </Link>
        </div>
      )}

      <Section title="Revenue">
        {m.revenue.length === 0 ? (
          <EmptyState title="No payments yet">Revenue appears here once Razorpay confirms a payment.</EmptyState>
        ) : (
          <DataTable label="Revenue by payment mode" minWidth={640}
            head={<><Th>Mode</Th><Th>Gross, 30 days</Th><Th>Refunded, 30 days</Th><Th>Gross, all time</Th><Th>Monthly recurring (MRR)</Th></>}
          >
            {m.revenue.map((r) => (
              <tr key={r.mode}>
                <td><ModeBadge mode={r.mode} /></td>
                <td className="tabular">{fmtInr(r.gross30dPaise)}</td>
                <td className="tabular">{fmtInr(r.refunded30dPaise)}</td>
                <td className="tabular">{fmtInr(r.grossAllTimePaise)}</td>
                <td className="tabular">{fmtInr(r.mrrPaise)}</td>
              </tr>
            ))}
          </DataTable>
        )}
        {m.revenue.some((r) => r.mode === "test") && (
          <p className="text-caption text-ink-600">Test-mode amounts are Razorpay sandbox payments — no real money.</p>
        )}
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-2">
        <Section title="Generations, last 14 days">
          <figure className="relative rounded-md border border-ink-200 bg-surface p-4">
            <div className="flex h-40 gap-1" aria-hidden>
              {m.jobs.daily.map((d) => (
                <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${d.succeeded} succeeded, ${d.failed} failed`}>
                  <div className="bg-error-fg/70" style={{ height: `${(d.failed / maxDay) * 100}%` }} />
                  <div className="bg-ink-800" style={{ height: `${(d.succeeded / maxDay) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-caption text-ink-500" aria-hidden>
              <span>{m.jobs.daily[0]?.day.slice(5)}</span>
              <span>{m.jobs.daily.at(-1)?.day.slice(5)}</span>
            </div>
            <figcaption className="mt-2 flex gap-4 text-caption text-ink-600">
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 bg-ink-800" aria-hidden /> Succeeded</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 bg-error-fg/70" aria-hidden /> Failed</span>
            </figcaption>
            <table className="sr-only">
              <caption>Generations per day (India time)</caption>
              <thead><tr><th>Day</th><th>Succeeded</th><th>Failed</th></tr></thead>
              <tbody>{m.jobs.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.succeeded}</td><td>{d.failed}</td></tr>)}</tbody>
            </table>
          </figure>
        </Section>

        <Section title="Subscriptions">
          {m.subscriptions.length === 0 ? (
            <EmptyState title="No active subscriptions" />
          ) : (
            <DataTable label="Subscriptions by plan" minWidth={420} head={<><Th>Plan</Th><Th>Mode</Th><Th>Active</Th><Th>Past due</Th></>}>
              {m.subscriptions.map((s) => (
                <tr key={`${s.planId}-${s.mode}`}>
                  <td>{planById(s.planId)?.name ?? s.planId}</td>
                  <td><ModeBadge mode={s.mode} /></td>
                  <td className="tabular">{s.active}</td>
                  <td className="tabular">{s.pastDue}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      </div>

      <Section title="Credits, last 30 days">
        {m.credits30d.length === 0 ? (
          <EmptyState title="No credit activity" />
        ) : (
          <StatGrid>
            {m.credits30d.map((c) => (
              <Stat key={c.type} label={{ grant: "Granted", debit: "Spent", refund: "Refunded", adjustment: "Adjusted", expiry: "Expired" }[c.type] ?? c.type} value={fmtCount(c.total)} />
            ))}
          </StatGrid>
        )}
      </Section>
    </div>
  );
}

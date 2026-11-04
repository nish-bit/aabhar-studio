import Link from "next/link";

import { fmtDateTime, shortId } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, Mono, Section, Stat, StatGrid, Th } from "@/components/admin/primitives";
import { Badge } from "@/components/ui/badge";
import { PRESETS, type PresetSlug } from "@/lib/presets";
import { errorSummary } from "@/server/admin/jobs";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Errors" };

export default async function AdminErrors() {
  const { admin, deps } = await adminPage("/admin/errors");
  const s = await errorSummary(deps, admin);

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Operational errors" description="Failures over the last 7 days, stuck work and payment webhook problems." />
      <StatGrid>
        <Stat label="Failed jobs (7 days)" value={s.failedByCode.reduce((n, x) => n + x.count, 0)} />
        <Stat label="Retryable failures" value={s.failedByCode.filter((x) => x.retryable).reduce((n, x) => n + x.count, 0)} />
        <Stat label="Stuck in processing" value={s.stuckJobs} tone={s.stuckJobs ? "error" : undefined} hint="past their lease" />
        <Stat label="Queued over 10 min" value={s.queuedOver10m} tone={s.queuedOver10m ? "warning" : undefined} />
        <Stat label="Webhook problems" value={s.webhookFailures.length} tone={s.webhookFailures.length ? "error" : undefined} />
      </StatGrid>

      <Section title="Failures by error code">
        {s.failedByCode.length === 0 ? (
          <EmptyState title="No failed jobs in the last 7 days" />
        ) : (
          <DataTable label="Failures by error code" minWidth={560} head={<><Th>Error code</Th><Th>Count</Th><Th>Retryable</Th><Th>Last seen</Th></>}>
            {s.failedByCode.map((e) => (
              <tr key={e.errorCode}>
                <td><Link className="underline" href={`/admin/jobs?status=failed&errorCode=${encodeURIComponent(e.errorCode)}`}><Mono>{e.errorCode}</Mono></Link></td>
                <td className="tabular">{e.count}</td>
                <td>{e.retryable ? <Badge tone="info">retryable</Badge> : <Badge tone="neutral">no</Badge>}</td>
                <td className="tabular">{fmtDateTime(e.lastAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Recent retryable jobs" actions={<Link className="text-body-sm underline" href="/admin/jobs?status=failed&retryable=1">See all</Link>}>
        {s.retryableJobs.length === 0 ? (
          <EmptyState title="Nothing to retry">Retryable failures from the last 14 days appear here.</EmptyState>
        ) : (
          <DataTable label="Recent retryable jobs" minWidth={640} head={<><Th>Job</Th><Th>Finished</Th><Th>Shop</Th><Th>Style</Th><Th>Error</Th></>}>
            {s.retryableJobs.map((j) => (
              <tr key={j.id}>
                <td><Link className="underline" href={`/admin/jobs/${j.id}`}><Mono>{shortId(j.id)}</Mono></Link></td>
                <td className="tabular">{fmtDateTime(j.finishedAt)}</td>
                <td>{j.shopName}</td>
                <td>{PRESETS[j.presetSlug as PresetSlug]?.name ?? j.presetSlug}</td>
                <td><Mono>{j.errorCode}</Mono></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Payment webhook problems">
        {s.webhookFailures.length === 0 ? (
          <EmptyState title="All webhooks processed" />
        ) : (
          <DataTable label="Webhook problems" minWidth={680} head={<><Th>Received</Th><Th>Event</Th><Th>Attempts</Th><Th>State</Th><Th>Last error</Th></>}>
            {s.webhookFailures.map((w) => (
              <tr key={w.eventId}>
                <td className="tabular">{fmtDateTime(w.receivedAt)}</td>
                <td><Link className="underline" href={`/admin/billing?tab=webhooks&q=${encodeURIComponent(w.eventId)}`}>{w.type}</Link></td>
                <td className="tabular">{w.attempts}</td>
                <td>{w.processed ? "processed" : "unprocessed"}</td>
                <td className="max-w-[320px] break-words">{w.lastError ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Rejected uploads (7 days)">
        {s.rejectedUploads.length === 0 ? (
          <EmptyState title="No rejected uploads" />
        ) : (
          <DataTable label="Rejected uploads by reason" minWidth={360} head={<><Th>Reason</Th><Th>Count</Th></>}>
            {s.rejectedUploads.map((r) => (
              <tr key={r.reason}>
                <td><Mono>{r.reason}</Mono></td>
                <td className="tabular">{r.count}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

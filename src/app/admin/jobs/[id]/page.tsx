import Link from "next/link";
import { notFound } from "next/navigation";

import { RetryJobButton } from "@/components/admin/actions";
import { fmtDateTime, fmtMs, fmtUsd } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, Facts, Mono, Section, StatusBadge, Th } from "@/components/admin/primitives";
import { PRESETS, type PresetSlug } from "@/lib/presets";
import { getJobDetail } from "@/server/admin/jobs";
import { DomainError } from "@/server/generation/domain-error";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Job" };

export default async function AdminJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin, deps } = await adminPage(`/admin/jobs/${id}`);
  const j = await getJobDetail(deps, admin, id).catch((err) => {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  });

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Generation job" description={j.id} />
      <Facts
        items={[
          ["Status", <><StatusBadge status={j.status} />{j.refunded ? " · credits refunded" : ""}</>],
          ["Shop", <Link key="s" className="underline" href={`/admin/users?q=${j.shopId}`}>{j.shopName ?? j.shopId}</Link>],
          ["Requested by", j.requesterEmail ?? "—"],
          ["Style", `${PRESETS[j.presetSlug as PresetSlug]?.name ?? j.presetSlug} (prompt v${j.presetVersion})`],
          ["Customer notes", j.hasInstructions ? `Yes (${j.instructionsLength} characters, private)` : "None"],
          ["Credits", String(j.creditCost)],
          ["Provider / model", `${j.provider} · ${j.model}`],
          ["Provider request id", j.providerRequestId ? <Mono>{j.providerRequestId}</Mono> : "—"],
          ["Provider cost", fmtUsd(j.costUsdMicros)],
          ["Created", fmtDateTime(j.createdAt)],
          ["Started", fmtDateTime(j.startedAt)],
          ["Finished", `${fmtDateTime(j.finishedAt)}${j.durationMs != null ? ` (${fmtMs(j.durationMs)})` : ""}`],
          ["Error", j.errorCode ? <><Mono>{j.errorCode}</Mono> {j.errorMessage}</> : "—"],
        ]}
      />

      {j.status === "failed" && (
        <Section title="Retry">
          <div className="rounded-md border border-ink-200 bg-surface p-4">
            {admin.role === "admin" ? (
              <RetryJobButton jobId={j.id} eligible={j.retry.eligible} why={j.retry.reason} />
            ) : (
              <p className="text-body-sm text-ink-600">{j.retry.eligible ? "Eligible for retry — an admin can retry it." : j.retry.reason}</p>
            )}
            {j.retry.retriedAs && (
              <p className="mt-2 text-body-sm">
                Retried as <Link className="underline" href={`/admin/jobs/${j.retry.retriedAs}`}><Mono>{j.retry.retriedAs}</Mono></Link>
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title="Provider attempts">
        {j.attemptList.length === 0 ? (
          <EmptyState title="No provider attempts recorded">The job may not have reached the provider.</EmptyState>
        ) : (
          <DataTable label="Provider attempts" minWidth={640} head={<><Th>#</Th><Th>When</Th><Th>Outcome</Th><Th>Error</Th><Th>Latency</Th><Th>Cost</Th><Th>Request id</Th></>}>
            {j.attemptList.map((a) => (
              <tr key={a.attemptNo}>
                <td className="tabular">{a.attemptNo}</td>
                <td className="tabular">{fmtDateTime(a.createdAt)}</td>
                <td><StatusBadge status={a.outcome === "succeeded" ? "succeeded" : "failed"} label={a.outcome.replace("_", " ")} /></td>
                <td>{a.errorCode ?? "—"}</td>
                <td className="tabular">{fmtMs(a.latencyMs)}</td>
                <td className="tabular">{fmtUsd(a.costUsdMicros)}</td>
                <td>{a.providerRequestId ? <Mono>{a.providerRequestId}</Mono> : "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

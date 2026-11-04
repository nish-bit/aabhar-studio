import Link from "next/link";

import { fmtDateTime, fmtMs, fmtUsd, shortId } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, FilterBar, Mono, Pagination, StatusBadge, Th } from "@/components/admin/primitives";
import { parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { PRESET_SLUGS, PRESETS, type PresetSlug } from "@/lib/presets";
import { jobFilterSchema, listJobs } from "@/server/admin/jobs";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Jobs" };

export default async function AdminJobs({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/jobs");
  const f = parseFilters(jobFilterSchema, await searchParams);
  const result = await listJobs(deps, admin, f);

  return (
    <>
      <AdminPageHeader title="Generation jobs" description="Status, failures, attempts and provider cost for every generation. Images and customer notes aren't shown." />
      <FilterBar
        action="/admin/jobs"
        q={f.q}
        qPlaceholder="Job, shop or user id · email · shop name"
        selects={[
          { name: "status", label: "Status", value: f.status, options: ["queued", "processing", "succeeded", "failed"].map((s) => ({ value: s, label: s })) },
          { name: "preset", label: "Style", value: f.preset, options: PRESET_SLUGS.map((s) => ({ value: s, label: PRESETS[s].name })) },
        ]}
        checkboxes={[{ name: "retryable", label: "Retryable failures only", checked: Boolean(f.retryable) }]}
        hidden={f.errorCode ? { errorCode: f.errorCode } : {}}
      />
      {f.errorCode && (
        <p className="mb-3 text-body-sm text-ink-700">
          Showing error code <Mono>{f.errorCode}</Mono>. <Link className="underline" href="/admin/jobs">Clear</Link>
        </p>
      )}
      {result.items.length === 0 ? (
        <EmptyState title="No jobs match">Clear the filters or try another search.</EmptyState>
      ) : (
        <DataTable
          label="Generation jobs"
          minWidth={900}
          head={<><Th>Job</Th><Th>Created</Th><Th>Shop</Th><Th>Style</Th><Th>Status</Th><Th>Error</Th><Th>Attempts</Th><Th>Duration</Th><Th>Cost</Th></>}
        >
          {result.items.map((j) => (
            <tr key={j.id}>
              <td><Link className="underline" href={`/admin/jobs/${j.id}`}><Mono>{shortId(j.id)}</Mono></Link></td>
              <td className="tabular">{fmtDateTime(j.createdAt)}</td>
              <td className="max-w-[200px]">
                {j.shopName}
                <span className="block truncate text-caption text-ink-500">{j.requesterEmail}</span>
              </td>
              <td>{PRESETS[j.presetSlug as PresetSlug]?.name ?? j.presetSlug}</td>
              <td><StatusBadge status={j.status} />{j.refunded && <span className="block text-caption text-ink-500">refunded</span>}</td>
              <td>{j.errorCode ? <Link className="underline" href={`/admin/jobs?errorCode=${encodeURIComponent(j.errorCode)}`}>{j.errorCode}</Link> : "—"}</td>
              <td className="tabular">{j.attempts}</td>
              <td className="tabular">{fmtMs(j.durationMs)}</td>
              <td className="tabular">{fmtUsd(j.costUsdMicros)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination
        basePath="/admin/jobs"
        params={{ q: f.q, status: f.status, preset: f.preset, errorCode: f.errorCode, retryable: f.retryable ? "1" : null }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}

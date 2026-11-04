import { Download } from "lucide-react";

import { fmtCount, fmtDate } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, FilterBar, Pagination, Stat, StatGrid, StatusBadge, Th } from "@/components/admin/primitives";
import { parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { Badge } from "@/components/ui/badge";
import { listSubscribers, marketingSummary, subscriberFilterSchema } from "@/server/admin/marketing";
import { isMarketingSchemaMissing } from "@/server/marketing/consent";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Marketing" };

const STATUS_LABELS = { subscribed: "Subscribed", unsubscribed: "Unsubscribed", pending: "Pending", none: "Not opted in" } as const;
const STATUS_BADGE = { subscribed: "active", unsubscribed: "cancelled", pending: "pending", none: "created" } as const;
const SOURCE_LABELS: Record<string, string> = { signup: "Sign-up", sign_in: "Sign-in page", settings: "Settings" };

export default async function AdminMarketing({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/marketing");
  const f = parseFilters(subscriberFilterSchema, await searchParams);
  let summary, result;
  try {
    [summary, result] = await Promise.all([marketingSummary(deps, admin), listSubscribers(deps, admin, f)]);
  } catch (err) {
    if (!isMarketingSchemaMissing(err)) throw err;
    return (
      <>
        <AdminPageHeader title="Marketing" />
        <EmptyState title="Marketing tables not set up yet">
          Apply migration <code>20261101000200_marketing.sql</code> (<code>npx supabase db push</code>), then reload this page.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Marketing"
        description="Who agreed to marketing emails. Only subscribed, active accounts that haven't bounced or complained are exported or emailed."
        actions={
          admin.role === "admin" && (
            <form action="/api/admin/marketing/export" method="post">
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-2 rounded-sm bg-ink-900 px-4 text-body-sm font-medium text-on-inverse hover:bg-ink-800"
              >
                <Download className="size-4" aria-hidden />
                Export eligible ({fmtCount(summary.eligible)}) as CSV
              </button>
            </form>
          )
        }
      />
      <div className="mb-6">
        <StatGrid>
          <Stat label="Registered users" value={fmtCount(summary.registeredUsers)} />
          <Stat label="Subscribed" value={fmtCount(summary.subscribed)} />
          <Stat label="Eligible to email" value={fmtCount(summary.eligible)} hint="Subscribed, active, not bounced" />
          <Stat label="Unsubscribed" value={fmtCount(summary.unsubscribed)} />
          <Stat label="Pending" value={fmtCount(summary.pending)} hint="Double opt-in is off" />
          <Stat label="Never opted in" value={fmtCount(summary.notOptedIn)} />
        </StatGrid>
      </div>
      <FilterBar
        action="/admin/marketing"
        q={f.q}
        qPlaceholder="Email address"
        selects={[
          {
            name: "status",
            label: "Status",
            value: f.status,
            options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />
      {result.items.length === 0 ? (
        <EmptyState title="No users match">Try a shorter search, or clear the filters.</EmptyState>
      ) : (
        <DataTable label="Marketing subscribers" head={<><Th>Email</Th><Th>Signed up</Th><Th>Status</Th><Th>Consent</Th><Th>Unsubscribed</Th></>}>
          {result.items.map((r) => (
            <tr key={r.userId}>
              <td className="max-w-[280px] break-words">
                {r.email ?? "(no email)"}
                {r.disabled && <Badge tone="error" className="ml-2">disabled</Badge>}
                {r.suppressionReason && <Badge tone="warning" className="ml-2">{r.suppressionReason}</Badge>}
              </td>
              <td className="tabular">{fmtDate(r.signedUpAt)}</td>
              <td>
                <StatusBadge status={STATUS_BADGE[r.status]} label={STATUS_LABELS[r.status]} />
              </td>
              <td className="tabular">
                {r.consentAt ? fmtDate(r.consentAt) : "—"}
                {r.consentSource && <span className="block text-caption text-ink-500">{SOURCE_LABELS[r.consentSource] ?? r.consentSource}</span>}
              </td>
              <td className="tabular">{r.unsubscribedAt ? fmtDate(r.unsubscribedAt) : "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/marketing" params={{ q: f.q, status: f.status }} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}

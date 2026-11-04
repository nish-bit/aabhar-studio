import Link from "next/link";

import { fmtDateTime, shortId } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, FilterBar, Mono, Pagination, Th } from "@/components/admin/primitives";
import { parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { cn } from "@/lib/utils";
import { ledgerFilterSchema, listLedger } from "@/server/admin/billing";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Credits" };

export default async function AdminCredits({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/credits");
  const f = parseFilters(ledgerFilterSchema, await searchParams);
  const r = await listLedger(deps, admin, f);
  return (
    <>
      <AdminPageHeader
        title="Credit transactions"
        description="The append-only credit ledger across all shops. To grant promotional credits, open a user and use “Grant credits”."
      />
      <FilterBar
        action="/admin/credits"
        q={f.q}
        qPlaceholder="Shop id, job id or shop name"
        selects={[{ name: "type", label: "Type", value: f.type, options: ["grant", "debit", "refund", "adjustment", "expiry"].map((t) => ({ value: t, label: t })) }]}
      />
      {r.items.length === 0 ? (
        <EmptyState title="No transactions match" />
      ) : (
        <DataTable label="Credit transactions" minWidth={760} head={<><Th>When</Th><Th>Shop</Th><Th>Type</Th><Th>Change</Th><Th>Balance after</Th><Th>Note</Th><Th>Job</Th></>}>
          {r.items.map((l) => (
            <tr key={l.id}>
              <td className="tabular">{fmtDateTime(l.createdAt)}</td>
              <td><Link className="underline" href={`/admin/users?q=${l.shopId}`}>{l.shopName}</Link></td>
              <td>{l.type}</td>
              <td className={cn("tabular", l.amount > 0 ? "text-success-fg" : "text-ink-900")}>{l.amount > 0 ? `+${l.amount}` : l.amount}</td>
              <td className="tabular">{l.balanceAfter}</td>
              <td>{l.reason ?? "—"}</td>
              <td>{l.jobId ? <Link className="underline" href={`/admin/jobs/${l.jobId}`}><Mono>{shortId(l.jobId)}</Mono></Link> : "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/credits" params={{ q: f.q, type: f.type }} page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}

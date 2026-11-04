import { z } from "zod";

import { fmtDateTime } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, FilterBar, Mono, Pagination, Th } from "@/components/admin/primitives";
import { parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { queryAudit } from "@/server/admin/audit";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Audit log" };

const ACTIONS = ["user.view", "user.disable", "user.enable", "user.auth_ban_failed", "credits.promo_grant", "job.retry", "plan.update", "plan.reset", "trial.update", "preset.update", "marketing.export", "refund_request.approve", "refund_request.reject", "support.respond"];

const filterSchema = z.object({
  q: z.string().trim().max(200).optional().nullable(),
  action: z.enum(ACTIONS as [string, ...string[]]).optional().nullable(),
  targetType: z.enum(["user", "shop", "job", "plan", "preset", "settings"]).optional().nullable(),
  page: z.coerce.number().int().optional().nullable(),
});

export default async function AdminAudit({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { deps } = await adminPage("/admin/audit");
  const f = parseFilters(filterSchema, await searchParams);
  const r = await queryAudit(deps.db, { actor: f.q, action: f.action, targetType: f.targetType, page: f.page });
  return (
    <>
      <AdminPageHeader title="Audit log" description="Every administrative change and every view of a customer's account details. Entries can't be edited or deleted." />
      <FilterBar
        action="/admin/audit"
        q={f.q}
        qLabel="Admin email"
        qPlaceholder="who did it"
        selects={[
          { name: "action", label: "Action", value: f.action, options: ACTIONS.map((a) => ({ value: a, label: a })) },
          { name: "targetType", label: "Target", value: f.targetType, options: ["user", "shop", "job", "plan", "preset", "settings"].map((t) => ({ value: t, label: t })) },
        ]}
      />
      {r.items.length === 0 ? (
        <EmptyState title="No audit entries match" />
      ) : (
        <DataTable label="Audit log" minWidth={900} head={<><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Reason</Th><Th>Details</Th></>}>
          {r.items.map((a) => (
            <tr key={a.id}>
              <td className="tabular">{fmtDateTime(a.createdAt)}</td>
              <td>{a.actorEmail ?? "—"}<span className="block text-caption text-ink-500">{a.actorRole}</span></td>
              <td><Mono>{a.action}</Mono></td>
              <td>{a.targetType}{a.targetId && <span className="block"><Mono>{a.targetId}</Mono></span>}</td>
              <td className="max-w-[240px]">{a.reason ?? "—"}</td>
              <td className="max-w-[320px]">
                {Object.keys(a.details).length ? (
                  <details>
                    <summary className="cursor-pointer text-caption text-ink-700">Show</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xs bg-surface-sunken p-2 text-[0.7rem]">{JSON.stringify(a.details, null, 2)}</pre>
                  </details>
                ) : "—"}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/audit" params={{ q: f.q, action: f.action, targetType: f.targetType }} page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}

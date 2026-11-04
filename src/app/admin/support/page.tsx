import { TicketReplyForm } from "@/components/admin/actions";
import { fmtDate } from "@/components/admin/format";
import { AdminPageHeader, EmptyState, Mono, StatusBadge, StatusTabs } from "@/components/admin/primitives";
import { one, type RawSearchParams } from "@/components/admin/search-params";
import { adminPage } from "@/server/http/admin";
import { listTicketsForAdmin } from "@/server/support/tickets";

export const metadata = { title: "Support tickets" };

const STATUSES = ["open", "answered", "closed"] as const;
const BADGE = { open: "pending", answered: "succeeded", closed: "cancelled" } as const;

export default async function AdminSupport({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/support");
  const raw = one(await searchParams, "status");
  const status = (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as (typeof STATUSES)[number]) : raw === "all" ? null : "open";
  const tickets = await listTicketsForAdmin(deps.db, admin, status);

  return (
    <>
      <AdminPageHeader
        title="Support tickets"
        description="Questions, bugs and ideas from customers. Replies show on the customer's Plans page; there's no email provider yet, so also email them at the address shown."
      />
      <StatusTabs basePath="/admin/support" current={status ?? "all"} options={[...STATUSES, "all"]} />
      {tickets.length === 0 ? (
        <EmptyState title={status === "open" ? "No open tickets" : "No tickets"}>Nothing here right now.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-md border border-ink-200 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-body-sm font-semibold text-ink-900">
                  {t.subject} <Mono>{t.reference}</Mono>
                </p>
                <StatusBadge status={BADGE[t.status]} label={t.status} />
              </div>
              <p className="mt-1 text-caption text-ink-600">
                {t.email ?? "(no email)"} · opened {fmtDate(t.createdAt)}
                {t.respondedAt ? ` · answered ${fmtDate(t.respondedAt)}` : ""}
              </p>
              <p className="mt-2 whitespace-pre-line text-body-sm text-ink-800">{t.description}</p>
              {admin.role === "admin" ? (
                <TicketReplyForm id={t.id} status={t.status} response={t.adminResponse} />
              ) : (
                t.adminResponse && <p className="mt-3 rounded-sm bg-surface-sunken p-3 text-body-sm text-ink-800">{t.adminResponse}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

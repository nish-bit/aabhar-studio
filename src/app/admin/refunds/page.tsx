import { RefundDecisionButtons } from "@/components/admin/actions";
import { fmtDate } from "@/components/admin/format";
import { AdminPageHeader, EmptyState, StatusBadge, StatusTabs } from "@/components/admin/primitives";
import { one, type RawSearchParams } from "@/components/admin/search-params";
import { dashboardDeps } from "@/server/dashboard/deps";
import { adminPage } from "@/server/http/admin";
import { listRefundRequestsForAdmin } from "@/server/support/refund-requests";

export const metadata = { title: "Refund requests" };

const STATUSES = ["pending", "approved", "rejected"] as const;
const BADGE = { pending: "pending", approved: "succeeded", rejected: "cancelled" } as const;

export default async function AdminRefunds({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/refunds");
  const raw = one(await searchParams, "status");
  const status = (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as (typeof STATUSES)[number]) : raw === "all" ? null : "pending";
  const requests = await listRefundRequestsForAdmin({ db: deps.db, storage: dashboardDeps()?.storage ?? null }, admin, status);

  return (
    <>
      <AdminPageHeader
        title="Refund requests"
        description="Photos customers say came out wrong. Compare each original with its result; approving returns the photos' credits. Failed generations are refunded automatically and never show up here."
      />
      <StatusTabs basePath="/admin/refunds" current={status ?? "all"} options={[...STATUSES, "all"]} />
      {requests.length === 0 ? (
        <EmptyState title={status === "pending" ? "No requests waiting" : "No requests"}>Nothing to review right now.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="rounded-md border border-ink-200 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-sm text-ink-900">
                  <span className="font-medium">{r.email ?? "(no email)"}</span>
                  <span className="text-ink-500"> · {fmtDate(r.createdAt)} · {r.creditsRequested} credits</span>
                </p>
                <StatusBadge status={BADGE[r.status]} label={r.status} />
              </div>
              <p className="mt-2 whitespace-pre-line text-body-sm text-ink-800">{r.reason}</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.images.map((i) => (
                  <li key={i.generatedImageId} className="rounded-sm border border-ink-200 p-2">
                    <p className="mb-1 text-caption text-ink-600">{i.styleName}: original → result</p>
                    <div className="grid grid-cols-2 gap-1">
                      {[i.originalUrl, i.url].map((src, n) =>
                        src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={n} src={src} alt={n === 0 ? "Original photo" : "Generated result"} className="aspect-square w-full rounded-xs object-cover" />
                        ) : (
                          <span key={n} className="flex aspect-square items-center justify-center rounded-xs bg-surface-sunken text-caption text-ink-500">
                            File removed
                          </span>
                        ),
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {r.adminNote && <p className="mt-3 text-body-sm text-ink-700"><span className="font-medium">Note to customer:</span> {r.adminNote}</p>}
              {r.status === "pending" && admin.role === "admin" && (
                <div className="mt-4">
                  <RefundDecisionButtons id={r.id} credits={r.creditsRequested} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import Link from "next/link";

import { fmtCount, fmtDate } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, FilterBar, Pagination, StatusBadge, Th } from "@/components/admin/primitives";
import { parseFilters, type RawSearchParams } from "@/components/admin/search-params";
import { Badge } from "@/components/ui/badge";
import { billingConfig, planById } from "@/config/billing";
import { listUsers, userFilterSchema } from "@/server/admin/users";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Users & shops" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { admin, deps } = await adminPage("/admin/users");
  const f = parseFilters(userFilterSchema, await searchParams);
  const result = await listUsers(deps, admin, f);

  return (
    <>
      <AdminPageHeader title="Users & shops" description="Each user's shop, plan, credit balance and account status. Open a user to manage them." />
      <FilterBar
        action="/admin/users"
        q={f.q}
        qPlaceholder="Email, shop name, user or shop id"
        selects={[
          {
            name: "status",
            label: "Status",
            value: f.status,
            options: [
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
              { value: "subscribed", label: "Subscribed" },
              { value: "admin", label: "Admins" },
            ],
          },
          { name: "plan", label: "Plan", value: f.plan, options: billingConfig.plans.filter((p) => p.monthlyPricePaise !== null).map((p) => ({ value: p.id, label: p.name })) },
        ]}
      />
      {result.items.length === 0 ? (
        <EmptyState title="No users match">Try a shorter search, or clear the filters.</EmptyState>
      ) : (
        <DataTable
          label="Users"
          head={<><Th>User</Th><Th>Shop</Th><Th>Plan</Th><Th>Credits</Th><Th>Jobs (30d)</Th><Th>Joined</Th><Th>Status</Th></>}
        >
          {result.items.map((u) => (
            <tr key={u.id}>
              <td className="max-w-[260px]">
                <Link href={`/admin/users/${u.id}`} className="font-medium text-ink-900 underline-offset-4 hover:underline">
                  {u.email ?? "(no email)"}
                </Link>
                {u.adminRole && <Badge tone="gold" className="ml-2">{u.adminRole}</Badge>}
              </td>
              <td>
                {u.shopName ?? "—"}
                {u.role && <span className="block text-caption text-ink-500">{u.role}</span>}
              </td>
              <td>
                {u.planId ? planById(u.planId)?.name ?? u.planId : "Trial"}
                {u.subscriptionStatus && <span className="block"><StatusBadge status={u.subscriptionStatus} /></span>}
              </td>
              <td className="tabular">{fmtCount(u.balance)}</td>
              <td className="tabular">{fmtCount(u.jobs30d)}</td>
              <td className="tabular">{fmtDate(u.createdAt)}</td>
              <td>{u.disabledAt ? <StatusBadge status="disabled" /> : <StatusBadge status="active" />}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination basePath="/admin/users" params={{ q: f.q, status: f.status, plan: f.plan }} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}

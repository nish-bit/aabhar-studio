import Link from "next/link";
import { notFound } from "next/navigation";

import { DisableUserButton, GrantCreditsButton } from "@/components/admin/actions";
import { fmtCount, fmtDate, fmtDateTime, fmtInr, fmtUsd, shortId } from "@/components/admin/format";
import { AdminPageHeader, DataTable, EmptyState, Facts, Mono, Section, StatusBadge, Th } from "@/components/admin/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { planById } from "@/config/billing";
import { PRESETS, type PresetSlug } from "@/lib/presets";
import { getUserDetail } from "@/server/admin/users";
import { DomainError } from "@/server/generation/domain-error";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "User" };

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin, deps } = await adminPage(`/admin/users/${id}`);
  const u = await getUserDetail(deps, admin, id).catch((err) => {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  });
  const canWrite = admin.role === "admin";
  const isSelf = u.id === admin.userId;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={u.email ?? "User"}
        description={`User ${u.id}`}
        actions={
          canWrite && (
            <>
              {u.shopId && <GrantCreditsButton shopId={u.shopId} shopName={u.shopName} />}
              {!isSelf && !u.adminRole && <DisableUserButton userId={u.id} email={u.email} disabled={Boolean(u.disabledAt)} />}
            </>
          )
        }
      />

      {u.disabledAt && (
        <Alert tone="error" title={`Disabled on ${fmtDateTime(u.disabledAt)}${u.disabledByEmail ? ` by ${u.disabledByEmail}` : ""}`}>
          {u.disabledReason}
        </Alert>
      )}
      <p className="text-caption text-ink-600">
        Customer photos, results, catalogue contents and prompt notes are private and aren&apos;t shown here. This view was recorded in the audit log.
      </p>

      <Facts
        items={[
          ["Shop", u.shopName ? <>{u.shopName} <span className="text-ink-500">({u.role})</span></> : "—"],
          ["Shop id", u.shopId ? <Mono>{u.shopId}</Mono> : "—"],
          ["Joined", fmtDateTime(u.createdAt)],
          ["Plan", <>{u.planId ? planById(u.planId)?.name ?? u.planId : "Trial"} <Badge tone="neutral">{u.entitlementState.replace("_", " ")}</Badge></>],
          ["Subscription", u.subscriptionStatus ? <StatusBadge status={u.subscriptionStatus} /> : "None"],
          ["Credit balance", fmtCount(u.balance)],
          ["Generations", `${fmtCount(u.jobs.total)} total · ${fmtCount(u.jobs.succeeded)} succeeded · ${fmtCount(u.jobs.failed)} failed`],
          ["Provider cost (all time)", fmtUsd(u.jobs.costUsdMicros)],
          ["Uploads", `${fmtCount(u.uploads.total)} · ${fmtCount(u.uploads.rejected)} rejected`],
          ["Catalogues (projects)", `${u.catalogues.active} active · ${u.catalogues.deleted} deleted · ${u.catalogues.items} products · ${u.catalogues.exports} exports`],
          ["Last catalogue change", fmtDateTime(u.catalogues.lastUpdatedAt)],
          ["Admin role", u.adminRole ?? "—"],
        ]}
      />

      <Section title="Credit lots">
        {u.grants.length === 0 ? (
          <EmptyState title="No usable credits" />
        ) : (
          <DataTable label="Usable credit lots" minWidth={480} head={<><Th>Source</Th><Th>Left</Th><Th>Expires</Th></>}>
            {u.grants.map((g) => (
              <tr key={g.id}>
                <td>{g.source.replace("_", " ")}</td>
                <td className="tabular">{g.remaining} / {g.amount}</td>
                <td className="tabular">{g.expiresAt ? fmtDate(g.expiresAt) : "Never"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Recent generations" actions={u.shopId && <Link className="text-body-sm underline" href={`/admin/jobs?q=${u.shopId}`}>All jobs</Link>}>
        {u.recentJobs.length === 0 ? (
          <EmptyState title="No generations yet" />
        ) : (
          <DataTable label="Recent generations" head={<><Th>Job</Th><Th>Created</Th><Th>Style</Th><Th>Status</Th><Th>Error</Th><Th>Cost</Th></>}>
            {u.recentJobs.map((j) => (
              <tr key={j.id}>
                <td><Link className="underline" href={`/admin/jobs/${j.id}`}><Mono>{shortId(j.id)}</Mono></Link></td>
                <td className="tabular">{fmtDateTime(j.createdAt)}</td>
                <td>{PRESETS[j.presetSlug as PresetSlug]?.name ?? j.presetSlug}</td>
                <td><StatusBadge status={j.status} /></td>
                <td>{j.errorCode ?? "—"}</td>
                <td className="tabular">{fmtUsd(j.costUsdMicros)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Payments">
        {u.recentPayments.length === 0 ? (
          <EmptyState title="No payments" />
        ) : (
          <DataTable label="Payments" head={<><Th>Date</Th><Th>Description</Th><Th>Amount</Th><Th>Status</Th><Th>Reference</Th></>}>
            {u.recentPayments.map((p) => (
              <tr key={p.id}>
                <td className="tabular">{fmtDate(p.createdAt)}</td>
                <td>{p.description}</td>
                <td className="tabular">{fmtInr(p.amountPaise)}{p.amountRefundedPaise > 0 && <span className="block text-caption">{fmtInr(p.amountRefundedPaise)} refunded</span>}</td>
                <td><StatusBadge status={p.status} /> {p.mode === "test" && <Badge tone="info">test</Badge>}</td>
                <td><Mono>{p.razorpayPaymentId}</Mono></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Credit transactions" actions={u.shopId && <Link className="text-body-sm underline" href={`/admin/credits?q=${u.shopId}`}>All transactions</Link>}>
        {u.recentLedger.length === 0 ? (
          <EmptyState title="No credit activity" />
        ) : (
          <DataTable label="Credit transactions" head={<><Th>Date</Th><Th>Type</Th><Th>Change</Th><Th>Balance</Th><Th>Note</Th></>}>
            {u.recentLedger.map((l) => (
              <tr key={l.id}>
                <td className="tabular">{fmtDateTime(l.createdAt)}</td>
                <td>{l.type}</td>
                <td className="tabular">{l.amount > 0 ? `+${l.amount}` : l.amount}</td>
                <td className="tabular">{l.balanceAfter}</td>
                <td>{l.reason ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Admin changes to this account" actions={<Link className="text-body-sm underline" href="/admin/audit?targetType=user">Full audit log</Link>}>
        {u.audit.length === 0 ? (
          <EmptyState title="No admin actions yet" />
        ) : (
          <DataTable label="Admin activity" head={<><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Reason</Th></>}>
            {u.audit.map((a) => (
              <tr key={a.id}>
                <td className="tabular">{fmtDateTime(a.createdAt)}</td>
                <td>{a.actorEmail ?? "—"} <span className="text-caption text-ink-500">({a.actorRole})</span></td>
                <td><Mono>{a.action}</Mono></td>
                <td>{a.reason ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

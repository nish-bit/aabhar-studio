import { PlanEditButton, PlanResetButton, PresetEditButton, TrialEditButton } from "@/components/admin/actions";
import { fmtCount, fmtDateTime, fmtInr, fmtPct } from "@/components/admin/format";
import { AdminPageHeader, DataTable, ModeBadge, Mono, Section, Th } from "@/components/admin/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PRESETS, type PresetSlug } from "@/lib/presets";
import { getAdminConfig } from "@/server/admin/configuration";
import { adminPage } from "@/server/http/admin";

export const metadata = { title: "Plans & presets" };

export default async function AdminSettings() {
  const { admin, deps } = await adminPage("/admin/settings");
  const c = await getAdminConfig(deps, admin);
  const canWrite = admin.role === "admin";

  return (
    <div className="space-y-10">
      <AdminPageHeader
        title="Plans & presets"
        description="Plan limits, monthly credits, the free trial and editing styles. Changes apply immediately and are audited."
      />
      {!c.pricesApproved && (
        <Alert tone="warning" title="Prices are still indicative">
          Prices come from <Mono>src/config/billing.ts</Mono> and Razorpay Plans; they aren&apos;t editable here. Change them in the config and run{" "}
          <Mono>npm run billing:sync</Mono> after approval.
        </Alert>
      )}

      <Section title="Plans">
        <DataTable
          label="Plans"
          minWidth={980}
          head={<><Th>Plan</Th><Th>Price (config)</Th><Th>Credits / month</Th><Th>At once</Th><Th>Per day</Th><Th>Catalogues</Th><Th>Styles</Th><Th>Subscribers</Th><Th><span className="sr-only">Actions</span></Th></>}
        >
          {c.plans.map((p) => (
            <tr key={p.id}>
              <td>
                <span className="font-medium">{p.name}</span>
                {p.overridden && <Badge tone="gold" className="ml-2" title={`Changed ${fmtDateTime(p.overriddenAt)}`}>edited</Badge>}
                {p.prices.filter((x) => x.active).map((x) => (
                  <span key={x.razorpayPlanId} className="mt-1 flex items-center gap-1 whitespace-nowrap text-caption [&_code]:break-normal"><ModeBadge mode={x.mode} /><Mono>{x.razorpayPlanId}</Mono></span>
                ))}
              </td>
              <td className="tabular">{p.configMonthlyPricePaise === null ? "Free" : fmtInr(p.configMonthlyPricePaise)}</td>
              <td className="tabular">{p.isPaid ? fmtCount(p.monthlyCredits) : `${c.trial.credits} once`}</td>
              <td className="tabular">{p.limits.maxActiveJobs}</td>
              <td className="tabular">{fmtCount(p.limits.dailyGenerations)}</td>
              <td className="tabular">{p.limits.maxCatalogues} × {p.limits.maxCatalogueItems}</td>
              <td className="max-w-[180px] text-caption">
                {p.limits.presets === "all" ? "All" : p.limits.presets.map((s) => PRESETS[s as PresetSlug]?.name ?? s).join(", ")}
              </td>
              <td className="tabular">{p.isPaid ? p.activeSubscribers : "—"}</td>
              <td className="whitespace-nowrap text-right">
                {canWrite && (
                  <>
                    <PlanEditButton plan={p} />
                    {p.overridden && <PlanResetButton planId={p.id} name={p.name} />}
                  </>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <p className="text-caption text-ink-600">
          Limits apply to every shop on the plan straight away. A change to monthly credits applies from each shop&apos;s next renewal.
        </p>
      </Section>

      <Section title="Free trial" actions={canWrite && <TrialEditButton credits={c.trial.credits} validityDays={c.trial.validityDays} />}>
        <p className="rounded-md border border-ink-200 bg-surface p-4 text-body-sm text-ink-800">
          New sign-ups get <strong className="tabular">{c.trial.credits}</strong> credits, valid for <strong className="tabular">{c.trial.validityDays}</strong> days.
        </p>
      </Section>

      <Section title="Editing styles (presets)">
        <DataTable
          label="Editing styles"
          minWidth={720}
          head={<><Th>Style</Th><Th>Available</Th><Th>Credits per image</Th><Th>Prompt version</Th><Th>Jobs (30d)</Th><Th>Failure rate</Th><Th><span className="sr-only">Actions</span></Th></>}
        >
          {c.presets.map((p) => (
            <tr key={p.slug}>
              <td className="font-medium">{p.name}<span className="block"><Mono>{p.slug}</Mono></span></td>
              <td>{p.enabled ? <Badge tone="success">on</Badge> : <Badge tone="neutral">off</Badge>}</td>
              <td className="tabular">{p.creditCost}{p.creditCost !== p.defaultCreditCost && <span className="text-caption text-ink-500"> (default {p.defaultCreditCost})</span>}</td>
              <td className="tabular">v{p.version}</td>
              <td className="tabular">{fmtCount(p.jobs30d)}</td>
              <td className="tabular">{fmtPct(p.failureRate30d)}</td>
              <td className="text-right">{canWrite && <PresetEditButton preset={p} />}</td>
            </tr>
          ))}
        </DataTable>
        <p className="text-caption text-ink-600">Prompts live in code (versioned and tested), so they&apos;re not editable here.</p>
      </Section>

      <Section title="Credit packs">
        <DataTable label="Credit packs" minWidth={480} head={<><Th>Pack</Th><Th>Credits</Th><Th>Price</Th><Th>Valid for</Th></>}>
          {c.packs.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="tabular">{p.credits}</td>
              <td className="tabular">{fmtInr(p.pricePaise)}</td>
              <td className="tabular">{p.validityDays} days</td>
            </tr>
          ))}
        </DataTable>
        <p className="text-caption text-ink-600">Pack prices are set in the billing config, like plan prices.</p>
      </Section>
    </div>
  );
}

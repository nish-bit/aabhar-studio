import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { FreeTrialStatus } from "@/components/billing/free-trial-status";
import { GeneratorSteps } from "@/components/studio/generator-steps";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { JewelleryTypePicker } from "@/components/studio/jewellery-type-picker";
import { Studio } from "@/components/studio/studio";
import { isJewelleryType, type JewelleryTypeId } from "@/lib/jewellery-types";
import { isPhotoSize, type PhotoSizeId } from "@/lib/photo-sizes";
import { getSessionUser } from "@/server/auth/session";
import { dashboardDeps } from "@/server/dashboard/deps";
import { getDashboard } from "@/server/dashboard/service";
import { BillingRepository } from "@/server/billing/repository";
import { database } from "@/server/db/postgres";
import { integrationStatus } from "@/server/env";
import { presetAllowed } from "@/config/billing";
import { PRESET_SLUGS, type PresetAvailability } from "@/lib/presets";
import { generationDeps } from "@/server/generation/deps";
import { defaultPresetSettings } from "@/server/presets/settings";

export const metadata = { title: "Generator" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The generator. Step 1 (jewellery type) shows until a type is chosen;
 * steps 2-4 are the existing studio (upload, style, generate). The type is
 * carried in ?type=, and ?step=type reopens step 1 to change it.
 */
export default function StudioPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<StudioSkeleton />}>
      <Generator searchParams={searchParams} />
    </Suspense>
  );
}

async function Generator({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const type = isJewelleryType(sp.type) ? sp.type : null;
  if (!type || sp.step === "type") return <TypeStep initial={type} />;
  return <StudioGate jewelleryType={type} photoSize={isPhotoSize(sp.size) ? sp.size : null} />;
}

async function TypeStep({ initial }: { initial: JewelleryTypeId | null }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/studio");
  const deps = dashboardDeps();
  const account = deps ? await getDashboard(deps, user.id, 0) : null;

  return (
    <>
      <GeneratorSteps current={1} />
      <div className="mb-6 max-w-2xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">What are you photographing?</h1>
        <p className="mt-2 text-body text-ink-600">Select the type of jewellery piece.</p>
      </div>
      {account?.freeTrial ? (
        <FreeTrialStatus trial={account.freeTrial} balance={account.balance} className="mb-8 max-w-3xl" />
      ) : (
        account &&
        account.balance === 0 && (
          <div className="mb-8 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-bg p-4">
            <p className="text-body-sm text-ink-800">You&apos;re out of credits. You can still choose a piece; you&apos;ll need credits to generate.</p>
            <Link href="/app/billing" className="text-body-sm font-semibold text-gold-700 underline underline-offset-2">
              Buy Credits
            </Link>
          </div>
        )
      )}
      <JewelleryTypePicker initial={initial} />
    </>
  );
}

/** Steps 2-4: the existing studio. Reads the session at request time. */
async function StudioGate({ jewelleryType, photoSize }: { jewelleryType: JewelleryTypeId; photoSize: PhotoSizeId | null }) {
  await connection();

  const status = integrationStatus();
  if (!status.supabase) {
    return (
      <IntegrationNotice title="Database, storage and sign-in not connected">
        Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> and{" "}
        <code>SUPABASE_SECRET_KEY</code>, then apply the migration in <code>supabase/migrations</code>. See{" "}
        <code>docs/IMAGE_GENERATION_SETUP.md</code>.
      </IntegrationNotice>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/studio?type=${jewelleryType}`)}`);

  const deps = generationDeps();
  const membership = await deps.repo.getMembership(user.id);
  const balance = membership ? await deps.repo.getBalance(membership.shopId) : 0;
  const sql = database();
  const freeTrial = membership && sql ? await new BillingRepository(sql).freeTrial(membership.shopId) : null;
  const [settings, limits] = await Promise.all([
    deps.presetSettings ? deps.presetSettings() : Promise.resolve(defaultPresetSettings()),
    membership && deps.entitlements ? deps.entitlements(membership.shopId) : Promise.resolve(null),
  ]);
  const presetAvailability = Object.fromEntries(
    PRESET_SLUGS.map((s) => [s, { ...settings[s], allowed: limits ? presetAllowed(limits.presets, s) : true }]),
  ) as PresetAvailability;

  return (
    <Studio
      initialBalance={balance}
      providerConfigured={status.imageProvider}
      providerLabel={status.providerLabel}
      presetAvailability={presetAvailability}
      jewelleryType={jewelleryType}
      initialPhotoSize={photoSize}
      freeTrial={freeTrial}
    />
  );
}

function StudioSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-12" aria-busy="true" aria-label="Loading studio">
      <div className="h-[560px] animate-pulse rounded-md bg-surface-sunken lg:col-span-5" />
      <div className="h-[560px] animate-pulse rounded-md bg-surface-sunken lg:col-span-7" />
    </div>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CatalogueSetupNotice } from "@/components/catalogues/catalogue-gate";
import { BusinessProfileForm } from "@/components/settings/business-profile-form";
import { getSessionUser } from "@/server/auth/session";
import { catalogueDeps } from "@/server/catalogue/deps";
import { getBusinessProfile } from "@/server/catalogue/service";
import { integrationStatus } from "@/server/env";

export const metadata = { title: "Business details" };

export default function BusinessSettingsPage() {
  return (
    <>
      <div className="mb-8 max-w-2xl">
        <h1 className="font-serif text-display-md font-medium text-ink-900">Business details</h1>
        <p className="mt-2 text-body text-ink-600">Your name, logo and contact details for catalogue covers and contact pages.</p>
      </div>
      <Suspense fallback={<div className="h-96 max-w-2xl animate-pulse rounded-md bg-surface-sunken" aria-busy="true" />}>
        <Gate />
      </Suspense>
    </>
  );
}

async function Gate() {
  const status = integrationStatus();
  if (!status.supabase || !status.database) return <CatalogueSetupNotice />;
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/settings/business");
  const deps = catalogueDeps();
  const [profile, membership] = await Promise.all([getBusinessProfile(deps, user.id), deps.repo.membership(user.id)]);
  return <BusinessProfileForm initial={profile} canEdit={membership?.role !== "viewer"} />;
}

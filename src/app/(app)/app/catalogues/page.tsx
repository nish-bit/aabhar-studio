import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CatalogueSetupNotice } from "@/components/catalogues/catalogue-gate";
import { CatalogueList } from "@/components/catalogues/catalogue-list";
import { getSessionUser } from "@/server/auth/session";
import { catalogueDeps } from "@/server/catalogue/deps";
import { listCatalogues } from "@/server/catalogue/service";
import { integrationStatus } from "@/server/env";

export const metadata = { title: "Catalogues" };

export default function CataloguesPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-surface-sunken" aria-busy="true" aria-label="Loading catalogues" />}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();

  const status = integrationStatus();
  if (!status.supabase || !status.database) {
    return (
      <>
        <h1 className="mb-6 font-serif text-display-md font-medium text-ink-900">Catalogues</h1>
        <CatalogueSetupNotice />
      </>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/catalogues");
  const deps = catalogueDeps();
  const [items, deleted, membership] = await Promise.all([
    listCatalogues(deps, user.id),
    listCatalogues(deps, user.id, true),
    deps.repo.membership(user.id),
  ]);
  return <CatalogueList initial={items} initialDeleted={deleted} canEdit={membership?.role !== "viewer"} />;
}

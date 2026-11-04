import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { CatalogueEditor } from "@/components/catalogues/catalogue-editor";
import { CatalogueSetupNotice } from "@/components/catalogues/catalogue-gate";
import { getSessionUser } from "@/server/auth/session";
import { catalogueDeps } from "@/server/catalogue/deps";
import { getCatalogue } from "@/server/catalogue/service";
import { integrationStatus } from "@/server/env";
import { DomainError } from "@/server/generation/domain-error";

export const metadata = { title: "Catalogue" };

export default function CataloguePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="h-[600px] animate-pulse rounded-md bg-surface-sunken" aria-busy="true" aria-label="Loading catalogue" />}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Promise<{ id: string }> }) {
  const status = integrationStatus();
  if (!status.supabase || !status.database) return <CatalogueSetupNotice />;
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/app/catalogues/${parsed.data}`);
  const deps = catalogueDeps();
  const [catalogue, membership] = await Promise.all([
    getCatalogue(deps, user.id, parsed.data).catch((err: unknown) => {
      if (err instanceof DomainError && err.code === "not_found") return null;
      throw err;
    }),
    deps.repo.membership(user.id),
  ]);
  if (!catalogue) notFound();
  return <CatalogueEditor initial={catalogue} canEdit={membership?.role !== "viewer"} />;
}

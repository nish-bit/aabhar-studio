import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { DomainError } from "@/server/generation/domain-error";
import { adminPage } from "@/server/http/admin";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

/**
 * The admin area. Access is decided on the server for every request
 * (AdminGate here, and again in each page and API route); non-admins get a
 * plain 404 so the area isn't revealed.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <Suspense fallback={<AdminSkeleton />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </div>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  let ctx: Awaited<ReturnType<typeof adminPage>>;
  try {
    ctx = await adminPage();
  } catch (err) {
    if (err instanceof DomainError && err.code === "storage_not_configured") {
      return (
        <div className="mx-auto mt-16 max-w-xl px-4">
          <IntegrationNotice title="Admin dashboard not connected">
            Set <code>DATABASE_URL</code> and the Supabase keys, apply the migrations, then grant yourself a role with{" "}
            <code>npm run admin:role -- grant you@example.com admin</code>. See <code>docs/ADMIN.md</code>.
          </IntegrationNotice>
        </div>
      );
    }
    throw err; // includes notFound() / redirect()
  }
  const { admin, deps } = ctx;
  return (
    <>
      <header className="border-b border-ink-200 bg-surface-inverse text-on-inverse">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 md:px-8">
          <Link href="/admin" className="flex items-center gap-2 font-serif text-heading-md">
            Aabhar Studio <span className="font-sans text-caption uppercase tracking-[0.14em] text-on-inverse/70">Admin</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 text-caption">
            {deps.billingMode && <Badge tone={deps.billingMode === "live" ? "gold" : "inverse"}>Payments: {deps.billingMode}</Badge>}
            <Badge tone="inverse">{admin.role === "admin" ? "Admin" : "Support · read-only"}</Badge>
            <span className="hidden truncate text-on-inverse/80 md:inline">{admin.email}</span>
            <Link href="/app/studio" className="rounded-sm px-2 py-1 text-on-inverse/80 hover:bg-on-inverse/10 hover:text-on-inverse">
              Exit
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 md:px-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <AdminNav />
        </aside>
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
    </>
  );
}

function AdminSkeleton() {
  return <div className="mx-auto mt-20 h-96 max-w-[1200px] animate-pulse rounded-md bg-surface-sunken" aria-busy="true" aria-label="Loading admin" />;
}

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Coins, ImageIcon, LifeBuoy, PlayCircle, Sparkles } from "lucide-react";

import { FreeTrialStatus } from "@/components/billing/free-trial-status";
import { ImageGrid } from "@/components/dashboard/image-grid";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { Button } from "@/components/ui/button";
import { brand } from "@/content/marketing";
import { formatCount } from "@/lib/format";
import { getSessionUser } from "@/server/auth/session";
import { dashboardDeps } from "@/server/dashboard/deps";
import { getDashboard, greetingName } from "@/server/dashboard/service";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

const whatsappHref = (number: string) =>
  `https://wa.me/${number}?text=${encodeURIComponent("Hi! I need help with my Aabhar Studio account.")}`;

async function Dashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app/dashboard");
  const deps = dashboardDeps();
  if (!deps) {
    return (
      <IntegrationNotice title="Dashboard not connected">
        Set <code>DATABASE_URL</code> and the Supabase keys, and apply the migrations in <code>supabase/migrations</code>.
      </IntegrationNotice>
    );
  }
  const data = await getDashboard(deps, user.id);

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-overline font-semibold uppercase tracking-[0.14em] text-gold-700">Your studio</p>
          <h1 className="mt-2 break-words font-serif text-display-md font-medium text-ink-900">Welcome, {greetingName(user)}</h1>
        </div>
        {brand.supportWhatsApp && (
          <Button asChild variant="secondary" className="self-start sm:self-auto">
            <a href={whatsappHref(brand.supportWhatsApp)} target="_blank" rel="noopener noreferrer">
              <LifeBuoy aria-hidden />
              Need help?
            </a>
          </Button>
        )}
      </header>

      <FreeTrialStatus trial={data.freeTrial} balance={data.balance} />

      <section aria-label="Your account" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={<ImageIcon aria-hidden />} label="Images created" value={formatCount(data.imagesMade)}>
          <Link href="/app/gallery" className="text-body-sm font-medium text-gold-700 underline-offset-4 hover:underline">
            Open gallery
          </Link>
        </StatCard>
        <StatCard
          icon={<Coins aria-hidden />}
          label="Available credits"
          value={formatCount(data.balance)}
          tone={data.balance === 0 ? "warning" : undefined}
        >
          <Button asChild size="sm">
            <Link href="/app/billing">Top up</Link>
          </Button>
        </StatCard>

        <div className="flex flex-col justify-between gap-4 rounded-md border border-gold-200 bg-gold-50 p-5 sm:col-span-2 lg:col-span-1">
          <div>
            <p className="flex items-center gap-2 text-body-sm font-semibold text-ink-900">
              <Sparkles className="size-4 text-gold-600" aria-hidden />
              New here?
            </p>
            <p className="mt-2 text-body-sm text-ink-700">
              Upload one clear photo of a piece, choose a style, and check the result next to your original before you download it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/app/studio">
                Open the generator
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            {brand.tutorialVideoUrl && (
              <Button asChild size="sm" variant="secondary">
                <a href={brand.tutorialVideoUrl} target="_blank" rel="noopener noreferrer">
                  <PlayCircle aria-hidden />
                  Watch the walkthrough
                </a>
              </Button>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="recent-title" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-title" className="font-serif text-display-sm font-medium text-ink-900">
            Your recent images
          </h2>
          {data.recent.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/gallery">
                See all
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          )}
        </div>
        {data.recent.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-ink-300 bg-surface px-6 py-12 text-center">
            <ImageIcon className="size-8 text-ink-400" strokeWidth={1.5} aria-hidden />
            <p className="text-heading-sm font-semibold text-ink-900">You haven&apos;t created any images yet.</p>
            <p className="max-w-sm text-body-sm text-ink-600">All you need is a clear phone photo of one piece.</p>
            <Button asChild className="mt-2">
              <Link href="/app/studio">
                Create your first image
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        ) : (
          <ImageGrid items={data.recent} />
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "warning";
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col justify-between gap-4 rounded-md border bg-surface p-5 ${tone === "warning" ? "border-warning-border" : "border-ink-200"}`}>
      <div>
        <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.1em] text-ink-600 [&_svg]:size-4 [&_svg]:text-gold-600">
          {icon}
          {label}
        </p>
        <p className="mt-2 font-serif text-display-md font-semibold tabular text-ink-900">{value}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-16 w-72 animate-pulse rounded-md bg-surface-sunken" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-md bg-surface-sunken" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}

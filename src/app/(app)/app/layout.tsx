import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";

import { AppNav, AppNavFallback } from "@/components/app/app-nav";
import { brand } from "@/content/marketing";
import { isAccountDisabled } from "@/server/auth/account-status";
import { getSessionUser } from "@/server/auth/session";

/** Signed-in pages are private: never index them. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/app/dashboard" className="flex min-w-0 flex-col leading-none" aria-label={`${brand.name} dashboard`}>
            <span className="truncate font-serif text-heading-md font-semibold uppercase tracking-[0.18em] text-ink-900">{brand.name}</span>
            <span className="mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.3em] text-gold-700">Jewellery studio</span>
          </Link>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm font-medium uppercase tracking-[0.08em] text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 md:px-8 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <aside className="border-b border-ink-200 py-3 lg:sticky lg:top-16 lg:self-start lg:border-b-0 lg:py-10">
          <Suspense fallback={<AppNavFallback />}>
            <AppNav />
          </Suspense>
        </aside>
        <main id="main" className="min-w-0 py-8 lg:py-10">
          <Suspense fallback={null}>
            <AccountGate>{children}</AccountGate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** Replaces app pages with a notice when an admin has disabled the account. */
async function AccountGate({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  // Only a gate for disabled accounts: if the session can't be checked right now,
  // the page underneath fails with its own error screen (and "Try again").
  const user = await getSessionUser().catch(() => null);

  if (user && (await isAccountDisabled(user.id).catch(() => false))) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-xl rounded-md border border-ink-200 bg-surface p-6"
      >
        <h1 className="text-heading-sm font-semibold text-ink-900">
          Account disabled
        </h1>
        <p className="mt-2 text-body-sm text-ink-600">
          Your account has been disabled. Please contact support for assistance.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
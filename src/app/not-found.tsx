import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center px-4 py-16">
      <p className="text-overline uppercase tracking-[0.12em] text-gold-700">404</p>
      <h1 className="mt-2 font-serif text-display-md text-ink-900">We couldn&apos;t find that page</h1>
      <p className="mt-3 text-body text-ink-600">The link may be old, or the page may have moved.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="rounded-sm bg-ink-900 px-4 py-2.5 text-body-sm font-medium text-on-inverse hover:bg-ink-800">
          Go to the homepage
        </Link>
        <Link href="/app/studio" className="rounded-sm border border-ink-300 px-4 py-2.5 text-body-sm text-ink-900 hover:bg-ink-100">
          Open the studio
        </Link>
      </div>
    </main>
  );
}

import { Container } from "@/components/shared/container";

/**
 * Layout for legal pages. Legal pages carry a visible DRAFT banner until the
 * owner replaces the highlighted placeholders and a lawyer reviews them;
 * plain information pages (like Contact) pass `draft={false}`.
 */
export function LegalPage({ title, updated, draft = true, children }: { title: string; updated: string; draft?: boolean; children: React.ReactNode }) {
  return (
    <Container width="narrow" className="py-12 md:py-16">
      {draft && (
        <div role="note" className="mb-8 rounded-md border border-warning-border bg-warning-bg p-4 text-body-sm text-ink-800">
          <strong className="text-warning-fg">Draft — not yet in force.</strong> Highlighted items need the business&apos;s details, and the
          whole page needs legal review before launch.
        </div>
      )}
      <h1 className="font-serif text-display-md font-medium text-ink-900">{title}</h1>
      <p className="mt-2 text-body-sm text-ink-600">Last updated: {updated}</p>
      <div className="mt-8 space-y-6 text-body text-ink-800 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-display-sm [&_h2]:text-ink-900 [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </Container>
  );
}

/** A value the business must supply before launch. */
export function Fill({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-xs bg-gold-100 px-1 text-ink-900">[{children}]</mark>;
}

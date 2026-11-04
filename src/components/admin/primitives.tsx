import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ headings */

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-serif text-display-sm font-medium text-ink-900 md:text-display-md">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body-sm text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, actions, id }: { title: string; children: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  const hid = id ?? `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={hid} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={hid} className="text-heading-md font-semibold text-ink-900">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- stats */

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</dl>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warning" | "error" }) {
  return (
    <div
      className={cn(
        "rounded-md border bg-surface p-4",
        tone === "error" ? "border-error-border" : tone === "warning" ? "border-warning-border" : "border-ink-200",
      )}
    >
      <dt className="text-caption text-ink-600">{label}</dt>
      <dd className="mt-1 tabular text-heading-lg font-semibold text-ink-900">{value}</dd>
      {hint && <dd className="mt-0.5 text-caption text-ink-500">{hint}</dd>}
    </div>
  );
}

/* --------------------------------------------------------------- table */

export function DataTable({ label, head, children, minWidth = 760 }: { label: string; head: React.ReactNode; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-ink-200 bg-surface" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full text-body-sm" style={{ minWidth }}>
        <caption className="sr-only">{label}</caption>
        <thead className="bg-surface-sunken text-left text-caption uppercase tracking-[0.06em] text-ink-600">
          <tr>{head}</tr>
        </thead>
        <tbody className="[&_tr]:border-t [&_tr]:border-ink-100 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-3 py-2 font-medium", className)}>
      {children}
    </th>
  );
}

/* --------------------------------------------------------- empty state */

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-ink-300 bg-surface px-6 py-10 text-center" role="status">
      <Inbox className="size-6 text-ink-400" aria-hidden />
      <p className="text-heading-sm font-semibold text-ink-900">{title}</p>
      {children && <div className="max-w-md text-body-sm text-ink-600">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- filters */

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A plain GET form: works without JavaScript, keeps filters in the URL so
 * views can be shared and the back button works. Paging resets on submit.
 */
export function FilterBar({
  action,
  q,
  qLabel = "Search",
  qPlaceholder,
  selects = [],
  checkboxes = [],
  hidden = {},
}: {
  action: string;
  q?: string | null;
  qLabel?: string;
  qPlaceholder?: string;
  selects?: { name: string; label: string; value?: string | null; options: FilterOption[] }[];
  checkboxes?: { name: string; label: string; checked?: boolean }[];
  hidden?: Record<string, string>;
}) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-col gap-3 rounded-md border border-ink-200 bg-surface p-3 md:flex-row md:flex-wrap md:items-end">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex min-w-0 flex-1 flex-col gap-1 md:min-w-[240px]">
        <span className="text-caption font-medium text-ink-700">{qLabel}</span>
        <span className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={qPlaceholder}
            maxLength={200}
            className="h-10 w-full rounded-sm border border-ink-300 bg-canvas pl-8 pr-3 text-body-sm text-ink-900 placeholder:text-ink-500 focus-visible:border-gold-600"
          />
        </span>
      </label>
      {selects.map((s) => (
        <label key={s.name} className="flex flex-col gap-1 md:w-44">
          <span className="text-caption font-medium text-ink-700">{s.label}</span>
          <select
            name={s.name}
            defaultValue={s.value ?? ""}
            className="h-10 rounded-sm border border-ink-300 bg-canvas px-2 text-body-sm text-ink-900 focus-visible:border-gold-600"
          >
            <option value="">All</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {checkboxes.map((c) => (
        <label key={c.name} className="flex h-10 items-center gap-2 text-body-sm text-ink-800">
          <input type="checkbox" name={c.name} value="1" defaultChecked={c.checked} className="size-4 accent-[var(--ink-900)]" />
          {c.label}
        </label>
      ))}
      <div className="flex gap-2">
        <button type="submit" className="h-10 rounded-sm bg-ink-900 px-4 text-body-sm font-medium text-on-inverse hover:bg-ink-800">
          Apply
        </button>
        <Link href={action} className="flex h-10 items-center rounded-sm px-3 text-body-sm text-ink-700 hover:bg-ink-100">
          Reset
        </Link>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------- status tabs */

/** A row of links filtering a list by status (?status=…). Works without JavaScript. */
export function StatusTabs({ basePath, current, options }: { basePath: string; current: string; options: readonly string[] }) {
  return (
    <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1">
      {options.map((o) => (
        <Link
          key={o}
          href={`${basePath}?status=${o}`}
          aria-current={o === current ? "page" : undefined}
          className={cn(
            "rounded-sm px-3 py-1.5 text-body-sm capitalize",
            o === current ? "bg-ink-900 font-medium text-on-inverse" : "text-ink-700 hover:bg-ink-100",
          )}
        >
          {o === "all" ? "All" : o}
        </Link>
      ))}
    </nav>
  );
}

/* ----------------------------------------------------------- pagination */

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | null | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "inline-flex h-9 items-center gap-1 rounded-sm border border-ink-300 bg-surface px-3 text-body-sm text-ink-900 hover:bg-ink-100";
  const offCls = "inline-flex h-9 items-center gap-1 rounded-sm border border-ink-200 px-3 text-body-sm text-ink-400";
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-col items-start justify-between gap-2 text-body-sm text-ink-600 sm:flex-row sm:items-center">
      <p className="tabular">
        {total === 0 ? "No results" : `${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkCls} href={href(page - 1)} rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : (
          <span className={offCls} aria-disabled="true">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </span>
        )}
        <span className="tabular" aria-current="page">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className={linkCls} href={href(page + 1)} rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={offCls} aria-disabled="true">
            Next <ChevronRight className="size-4" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}

/* --------------------------------------------------------------- badges */

const STATUS_TONES: Record<string, BadgeProps["tone"]> = {
  succeeded: "success", captured: "success", active: "success", processed: "success", authenticated: "success",
  failed: "error", halted: "error", disabled: "error",
  processing: "processing", queued: "neutral", pending: "warning", authorized: "warning", partially_refunded: "warning", paused: "warning",
  refunded: "neutral", cancelled: "neutral", completed: "neutral", expired: "neutral", created: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label ?? status.replaceAll("_", " ")}</Badge>;
}

export function ModeBadge({ mode }: { mode: "test" | "live" | null }) {
  if (!mode) return <span className="text-ink-400">—</span>;
  return <Badge tone={mode === "live" ? "gold" : "info"}>{mode}</Badge>;
}

export function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <code className="[overflow-wrap:anywhere] rounded-xs bg-surface-sunken px-1 py-0.5 font-mono text-[0.75rem] text-ink-800" title={title}>
      {children}
    </code>
  );
}

/** Definition list for detail pages. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-ink-200 bg-surface p-4 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-caption text-ink-600">{k}</dt>
          <dd className="mt-0.5 break-words text-ink-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

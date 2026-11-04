"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users & shops" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/errors", label: "Errors" },
  { href: "/admin/billing", label: "Payments" },
  { href: "/admin/credits", label: "Credits" },
  { href: "/admin/refunds", label: "Refund requests" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/settings", label: "Plans & presets" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-1 overflow-x-auto lg:mx-0 lg:overflow-visible">
      <ul className="flex gap-1 px-1 lg:flex-col lg:px-0">
        {LINKS.map((l) => {
          const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-sm px-3 py-2 text-body-sm",
                  active ? "bg-ink-900 font-medium text-on-inverse" : "text-ink-800 hover:bg-ink-100",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

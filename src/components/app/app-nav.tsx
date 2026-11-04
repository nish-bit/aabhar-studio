"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CreditCard, Images, LayoutDashboard, Settings, Wand2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: LucideIcon; match?: string }[] = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/studio", label: "Generator", icon: Wand2 },
  { href: "/app/gallery", label: "My gallery", icon: Images },
  { href: "/app/catalogues", label: "Catalogues", icon: BookOpen },
  { href: "/app/billing", label: "Plans", icon: CreditCard },
  { href: "/app/settings/account", label: "Settings", icon: Settings, match: "/app/settings" },
];

/**
 * App navigation: a sidebar on large screens, a scrollable tab row on small
 * ones. Reading the URL needs a Suspense boundary under Cache Components,
 * so the layout shows AppNavFallback (same links, nothing highlighted) first.
 */
export function AppNav() {
  return <NavList path={usePathname()} />;
}

export function AppNavFallback() {
  return <NavList path={null} />;
}

function NavList({ path }: { path: string | null }) {
  return (
    <nav aria-label="App" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {LINKS.map(({ href, label, icon: Icon, match }) => {
          const active = path !== null && path.startsWith(match ?? href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-sm px-3 py-2 text-body-sm font-medium uppercase tracking-[0.08em]",
                  "transition-colors duration-[var(--duration-fast)]",
                  active ? "bg-ink-900 text-on-inverse" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-gold-300" : "text-gold-600")} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

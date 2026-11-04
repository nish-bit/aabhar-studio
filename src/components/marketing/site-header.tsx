"use client";

import * as React from "react";
import Link from "next/link";
import { NavigationMenu } from "radix-ui";
import { ChevronDown, Menu } from "lucide-react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NavLink } from "@/types/content";

export interface SiteHeaderProps {
  brandName: string;
  primaryNav: NavLink[];
  solutionsNav: NavLink[];
  cta: { label: string; href: string };
  loginHref?: string;
}

/** Transparent at the top of the page, solid with a hairline once scrolled. */
export function SiteHeader({ brandName, primaryNav, solutionsNav, cta, loginHref = "/login" }: SiteHeaderProps) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-[var(--duration-slow)]",
        scrolled ? "border-b border-ink-200 bg-canvas/95 backdrop-blur-sm" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-6 px-4 md:px-6 lg:h-[72px] lg:px-8 xl:px-12">
        <Logo name={brandName} />

        {/* Desktop navigation */}
        <NavigationMenu.Root className="relative hidden lg:block" aria-label="Main">
          <NavigationMenu.List className="flex items-center gap-1">
            <NavigationMenu.Item>
              <NavigationMenu.Trigger className="group inline-flex h-10 items-center gap-1 rounded-sm px-3 text-body font-medium text-ink-700 transition-colors hover:text-ink-900 data-[state=open]:text-ink-900">
                Solutions
                <ChevronDown
                  aria-hidden
                  className="size-3.5 transition-transform duration-[var(--duration-base)] group-data-[state=open]:rotate-180"
                />
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className="absolute left-0 top-full w-[440px] pt-2 data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in-0 data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out-0">
                <ul className="grid gap-1 rounded-md border border-ink-200 bg-surface p-2 shadow-md">
                  {solutionsNav.map((item) => (
                    <li key={item.href}>
                      <NavigationMenu.Link asChild>
                        <Link
                          href={item.href}
                          className="block rounded-sm px-3 py-2.5 transition-colors hover:bg-gold-50 focus-visible:bg-gold-50"
                        >
                          <span className="block text-body font-medium text-ink-900">{item.label}</span>
                          {item.description && (
                            <span className="mt-0.5 block text-body-sm text-ink-600">{item.description}</span>
                          )}
                        </Link>
                      </NavigationMenu.Link>
                    </li>
                  ))}
                </ul>
              </NavigationMenu.Content>
            </NavigationMenu.Item>
            {primaryNav.map((item) => (
              <NavigationMenu.Item key={item.href}>
                <NavigationMenu.Link asChild>
                  <Link
                    href={item.href}
                    className="inline-flex h-10 items-center rounded-sm px-3 text-body font-medium text-ink-700 transition-colors hover:text-ink-900"
                  >
                    {item.label}
                  </Link>
                </NavigationMenu.Link>
              </NavigationMenu.Item>
            ))}
          </NavigationMenu.List>
        </NavigationMenu.Root>

        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="ghost">
            <Link href={loginHref}>Log in</Link>
          </Button>
          <Button asChild>
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>

        {/* Mobile navigation */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
              <Menu className="size-5" aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="gap-0 p-0" closeLabel="Close menu">
            <div className="px-6 pb-4 pt-5">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Site navigation</SheetDescription>
              <Logo name={brandName} />
            </div>
            <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-3">
              <ul className="grid">
                {primaryNav.map((item) => (
                  <li key={item.href}>
                    <SheetClose asChild>
                      <Link
                        href={item.href}
                        className="flex h-12 items-center rounded-sm px-3 text-heading-sm font-medium text-ink-900 hover:bg-ink-100"
                      >
                        {item.label}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
              </ul>
              <Separator className="my-3" />
              <p className="px-3 pb-1 text-overline font-semibold uppercase tracking-[0.12em] text-ink-500">Solutions</p>
              <ul className="grid">
                {solutionsNav.map((item) => (
                  <li key={item.href}>
                    <SheetClose asChild>
                      <Link
                        href={item.href}
                        className="flex h-11 items-center rounded-sm px-3 text-body text-ink-700 hover:bg-ink-100"
                      >
                        {item.label}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid gap-2 border-t border-ink-200 p-4">
              <Button asChild size="lg">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={loginHref}>Log in</Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

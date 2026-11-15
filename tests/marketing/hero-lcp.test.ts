import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hero } from "@/components/marketing/hero";
import { heroPair } from "@/content/demo-images";

/**
 * The homepage hero's "after" photo (/demo/tikka-studio.webp) is the LCP element. It must load
 * eagerly with high fetch priority; the "before" photo under it loads eagerly at normal priority.
 *
 * Next.js's dev-only LCP warning can still name this image: the homepage shows the same file again
 * further down (style card and Bridal showcase, lazily), all with the same fallback URL, and the
 * warning looks up only the last <Image> registered for a URL. That's a false positive; this test
 * pins what actually matters, the hero's own attributes.
 */
const html = renderToStaticMarkup(
  React.createElement(Hero, {
    overline: "o",
    title: "t",
    subtitle: "s",
    primaryCta: { label: "a", href: "/login" },
    secondaryCta: { label: "b", href: "/pricing" },
    trustLine: "x",
    pair: heroPair,
  }),
);
const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const find = (file: string) => imgs.find((i) => i.includes(encodeURIComponent(file)) || i.includes(file));

describe("homepage hero image (LCP)", () => {
  it("the studio (after) photo loads eagerly with high priority", () => {
    const after = find("/demo/tikka-studio.webp");
    expect(after).toBeDefined();
    expect(after).toMatch(/loading="eager"/);
    expect(after).toMatch(/fetchpriority="high"/i);
  });

  it("the phone (before) photo loads eagerly at normal priority, so it doesn't compete", () => {
    const before = find("/demo/tikka-studio-simulated-before.webp");
    expect(before).toBeDefined();
    expect(before).toMatch(/loading="eager"/);
    expect(before).not.toMatch(/fetchpriority="high"/i);
  });

  it("the hero renders just these two images", () => {
    expect(imgs).toHaveLength(2);
  });
});

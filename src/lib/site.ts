import type { Metadata } from "next";

/** Canonical public origin. Search engines should index this host only, not workers.dev. */
export const SITE_URL = "https://www.aabharstudio.com";
export const SITE_NAME = "Aabhar Studio";

/** Shared social preview image (public/og-image.jpg), built from the brand mark and a gallery photo. */
export const OG_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "Aabhar Studio — AI jewellery photography and catalogues",
};

/** Date the public pages' content last changed. Update it when you edit marketing or legal copy. */
export const CONTENT_UPDATED = "2026-11-09";

/** Public, indexable marketing pages. Sign-in, the app, admin, API, unsubscribe and referral links stay out. */
export const PUBLIC_PAGES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/styles", changeFrequency: "monthly", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/refunds", changeFrequency: "yearly", priority: 0.3 },
] as const;

export const absoluteUrl = (path: string) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);

/**
 * Metadata for a public page: title, description, canonical URL, and the
 * Open Graph and Twitter cards. A page's openGraph replaces the layout's
 * entirely, so every field is set here rather than inherited.
 */
export function pageMetadata({
  title,
  socialTitle,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  /** Title for link previews; defaults to "<title> | Aabhar Studio". */
  socialTitle?: string;
  description: string;
  path: string;
  /** Use the title as-is instead of the layout's "%s · Aabhar Studio" template. */
  absoluteTitle?: boolean;
}): Metadata {
  const shareTitle = socialTitle ?? (absoluteTitle ? title : `${title} | ${SITE_NAME}`);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_IN",
      url: path,
      title: shareTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [OG_IMAGE.url] },
  };
}

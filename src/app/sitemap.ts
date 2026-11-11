import type { MetadataRoute } from "next";

import { absoluteUrl, CONTENT_UPDATED, PUBLIC_PAGES } from "@/lib/site";

/** /sitemap.xml — static, built at deploy time. URLs match each page's canonical. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified: CONTENT_UPDATED,
    changeFrequency,
    priority,
  }));
}

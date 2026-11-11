import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Signed-in app, admin and API paths: nothing public to index there. */
const PRIVATE_PATHS = ["/app/", "/admin", "/api/"];

/**
 * Crawlers that build search indexes, including AI search (ChatGPT search,
 * Perplexity, Bing Copilot and Google AI Overviews all draw on these). Named
 * explicitly so the intent is on record; they'd also match "*".
 */
export const SEARCH_CRAWLERS = ["Googlebot", "Bingbot", "OAI-SearchBot", "PerplexityBot", "Applebot", "DuckDuckBot"];

/**
 * The site's AI policy: search yes, model training no. These are the agents
 * Cloudflare's managed robots.txt blocked while the site was proxied through
 * Cloudflare. With Cloudflare as DNS only (the site is served by Vercel), that
 * managed file no longer applies, so the same list lives here.
 *
 * Google-Extended and Applebot-Extended only control training use; Googlebot
 * and Applebot above still index the site for search.
 */
export const TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended",
  "GoogleOther",
  "Google-CloudVertexBot",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "cohere-ai",
  "MistralAI-Training",
  "Diffbot",
  "omgili",
  "Cotoyogi",
  "ICC-Crawler",
  "KimiBot",
  "PetalBot",
];

/**
 * AI fetchers acting for a user in a chat (not search indexing). Cloudflare's
 * managed policy blocked these too; kept as before. Remove an agent here to
 * let people open the site from that assistant.
 */
export const USER_TRIGGERED_AI_FETCHERS = [
  "ChatGPT-User",
  "Claude-User",
  "Perplexity-User",
  "MistralAI-User",
  "meta-externalfetcher",
  "Google-NotebookLM",
  "FirecrawlAgent",
];

/** /robots.txt */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: SEARCH_CRAWLERS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: [...TRAINING_CRAWLERS, ...USER_TRIGGERED_AI_FETCHERS], disallow: "/" },
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

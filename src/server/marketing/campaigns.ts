import type { Db } from "@/server/db/sql";
import { DomainError } from "@/server/generation/domain-error";

import { eligibleRecipients, type EligibleRecipient } from "./consent";

/**
 * Groundwork for marketing email. Nothing here runs yet: no route calls
 * sendCampaign, no provider adapter exists, and sending also requires
 * MARKETING_EMAILS_ENABLED=true. To connect Resend, Brevo or Mailchimp,
 * implement MarketingEmailProvider in ./providers/<name>.ts, return it from
 * marketingProvider() in ./provider.ts, and point the provider's
 * bounce/complaint webhook at a route that calls suppress() in ./consent.ts.
 */

export type CampaignKind = "newsletter" | "announcement" | "offer" | "welcome";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe headers (Gmail and Yahoo require them for bulk mail). */
  headers: Record<string, string>;
  tags: { kind: CampaignKind; campaignId: string };
}

export interface MarketingEmailProvider {
  readonly id: "resend" | "brevo" | "mailchimp";
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** A campaign's content. The unsubscribe footer is added for every recipient; templates can't leave it out. */
export interface CampaignTemplate {
  id: string;
  kind: CampaignKind;
  subject: string;
  /** Body HTML without a footer. */
  html: string;
  /** Plain-text body without a footer. */
  text: string;
}

export const unsubscribeUrl = (siteUrl: string, token: string) => `${siteUrl.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;

/** One-click target: mail apps POST here directly (no page, no sign-in). */
export const oneClickUnsubscribeUrl = (siteUrl: string, token: string) =>
  `${siteUrl.replace(/\/$/, "")}/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Builds one recipient's email, always with a visible unsubscribe link and the one-click headers. */
export function personalise(t: CampaignTemplate, r: EligibleRecipient, siteUrl: string): OutgoingEmail {
  const link = unsubscribeUrl(siteUrl, r.unsubscribeToken);
  const footer = "You're receiving this because you agreed to marketing emails from Aabhar Studio.";
  return {
    to: r.email,
    subject: t.subject,
    html: `${t.html}<hr><p style="font-size:12px;color:#666">${escapeHtml(footer)} <a href="${escapeHtml(link)}">Unsubscribe</a></p>`,
    text: `${t.text}\n\n--\n${footer}\nUnsubscribe: ${link}`,
    headers: {
      "List-Unsubscribe": `<${oneClickUnsubscribeUrl(siteUrl, r.unsubscribeToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: { kind: t.kind, campaignId: t.id },
  };
}

export interface CampaignDeps {
  db: Db;
  provider: MarketingEmailProvider | null;
  /** MARKETING_EMAILS_ENABLED. Off by default. */
  enabled: boolean;
  /** Public site URL for unsubscribe links. */
  siteUrl: string | null;
}

/**
 * Sends a campaign to eligible recipients only (active consent, not
 * suppressed, account active). Refuses to run unless sending is enabled
 * and a provider and site URL are configured.
 */
export async function sendCampaign(deps: CampaignDeps, template: CampaignTemplate): Promise<{ sent: number; failed: number }> {
  if (!deps.enabled) throw new DomainError("forbidden", "Marketing email is switched off (MARKETING_EMAILS_ENABLED).", 403);
  if (!deps.provider || !deps.siteUrl) throw new DomainError("internal_error", "No email provider or site URL is configured.", 503);
  let sent = 0;
  let failed = 0;
  for (const r of await eligibleRecipients(deps.db)) {
    try {
      await deps.provider.send(personalise(template, r, deps.siteUrl));
      sent++;
    } catch (err) {
      failed++;
      // No email address in logs.
      console.error(JSON.stringify({ event: "marketing.send_failed", campaignId: template.id, userId: r.userId, error: String(err).slice(0, 200) }));
    }
  }
  return { sent, failed };
}

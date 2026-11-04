"use client";

import * as React from "react";
import { Check, Copy, Gift, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import type { ReferralSummary } from "@/lib/support-types";

/** "Invite a jeweller": the user's link, copy and WhatsApp share, and how it's going. */
export function ReferralCard({ summary, origin }: { summary: ReferralSummary; origin: string }) {
  const link = `${origin}/r/${summary.code}`;
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const share = `https://wa.me/?text=${encodeURIComponent(
    `I use Aabhar Studio to turn phone photos of jewellery into studio shots. Join with my link and get ${summary.refereeCredits} extra photos when you buy your first plan: ${link}`,
  )}`;

  return (
    <section aria-labelledby="invite-title" className="rounded-md border border-gold-200 bg-gold-50 p-6">
      <div className="flex items-start gap-3">
        <Gift className="mt-1 size-6 shrink-0 text-gold-600" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="invite-title" className="font-serif text-display-sm text-ink-900">
            Invite a jeweller, get {summary.referrerCredits} free photos
          </h2>
          <p className="mt-1 text-body-sm text-ink-700">
            When a jeweller you invite buys a Solo, Signature or Studio plan, you get {summary.referrerCredits} free photos and they get{" "}
            {summary.refereeCredits} extra. Invites count for new accounts only.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Your invite link</span>
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-full rounded-sm border border-ink-300 bg-surface px-3 font-mono text-body-sm text-ink-900"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copy} aria-live="polite">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button asChild>
                <a href={share} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden />
                  Share on WhatsApp
                </a>
              </Button>
            </div>
          </div>
          <p className="mt-3 text-caption text-ink-600 tabular">
            Code {summary.code} · {formatCount(summary.invited)} invited · {formatCount(summary.rewarded)} bought a plan ·{" "}
            {formatCount(summary.creditsEarned)} photos earned
          </p>
        </div>
      </div>
    </section>
  );
}

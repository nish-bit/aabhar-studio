"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MARKETING_CONSENT, type MarketingPreferences, type MarketingStatus } from "@/lib/marketing";

const STATUS: Record<MarketingStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  subscribed: { label: "Subscribed", tone: "success" },
  unsubscribed: { label: "Unsubscribed", tone: "neutral" },
  pending: { label: "Awaiting confirmation", tone: "warning" },
  none: { label: "Not subscribed", tone: "neutral" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);

async function save(subscribed: boolean): Promise<MarketingPreferences> {
  let res: Response;
  try {
    res = await fetch("/api/marketing/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ subscribed }),
    });
  } catch {
    throw new Error("You appear to be offline. Please try again when you're connected.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Couldn't save your preference. Please try again.");
  }
  return (await res.json()) as MarketingPreferences;
}

/** Opt in or out of marketing email. Opting in needs the box ticked; nothing is pre-ticked. */
export function MarketingPreferencesForm({ initial }: { initial: MarketingPreferences }) {
  const [prefs, setPrefs] = React.useState(initial);
  const subscribed = prefs.status === "subscribed";
  const [agreed, setAgreed] = React.useState(subscribed);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty = agreed !== subscribed;
  const status = STATUS[prefs.status];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const next = await save(agreed);
      setPrefs(next);
      setAgreed(next.status === "subscribed");
      setMessage({
        tone: "success",
        text: next.status === "subscribed" ? "You're subscribed to marketing emails." : "You're unsubscribed. We won't send you marketing emails.",
      });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't save your preference." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {message && (
        <Alert tone={message.tone} live={message.tone === "error" ? "assertive" : "polite"}>
          {message.text}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-700">
        <span>Status:</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {subscribed && prefs.consentAt && <span className="text-ink-500">since {fmt(prefs.consentAt)}</span>}
        {prefs.status === "unsubscribed" && prefs.unsubscribedAt && <span className="text-ink-500">on {fmt(prefs.unsubscribedAt)}</span>}
      </div>
      <p className="text-body-sm text-ink-600">
        Occasional emails about new editing styles and features, offers on credit packs and plans, and our newsletter. Every email has an
        unsubscribe link. Emails about your account, sign-in and payments aren&apos;t affected by this setting.
      </p>
      <label className="flex items-start gap-3 rounded-sm border border-ink-200 bg-surface-raised p-3 text-body-sm text-ink-800">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={saving}
          className="mt-0.5 size-4 shrink-0 accent-[var(--ink-900)]"
        />
        <span>{MARKETING_CONSENT.text}</span>
      </label>
      <Button type="submit" disabled={!dirty} loading={saving} loadingLabel="Saving…">
        {dirty ? (agreed ? "Subscribe" : "Unsubscribe") : "Saved"}
      </Button>
    </form>
  );
}

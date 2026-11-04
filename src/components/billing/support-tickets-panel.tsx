"use client";

import * as React from "react";
import { LifeBuoy } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { billingApi } from "@/features/billing/api-client";
import type { TicketView } from "@/lib/support-types";

const STATUS: Record<TicketView["status"], { tone: "warning" | "success" | "neutral"; label: string }> = {
  open: { tone: "warning", label: "Open" },
  answered: { tone: "success", label: "Answered" },
  closed: { tone: "neutral", label: "Closed" },
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** "Help & Support": raise a ticket and follow the answers. Replies go to the sign-in email. */
export function SupportTicketsPanel({ initialTickets, email }: { initialTickets: TicketView[]; email: string | null }) {
  const [tickets, setTickets] = React.useState(initialTickets);
  const [open, setOpen] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await billingApi.createTicket(subject.trim(), description.trim());
      setTickets(res.tickets);
      setOpen(false);
      setSubject("");
      setDescription("");
      setMessage({ tone: "success", text: `Ticket ${res.tickets[0]?.reference ?? ""} created. We'll reply by email${email ? ` to ${email}` : ""}.` });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't create the ticket." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="support-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="support-title" className="font-serif text-display-sm text-ink-900">
            Help &amp; Support
          </h2>
          <p className="mt-1 text-body-sm text-ink-600">
            Anything other than a refund: a question, a bug, an idea. We&apos;ll get back to you by email.
          </p>
        </div>
        {!open && (
          <Button variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>
            <LifeBuoy aria-hidden />
            New ticket
          </Button>
        )}
      </div>
      {message && (
        <Alert tone={message.tone} live={message.tone === "error" ? "assertive" : "polite"}>
          {message.text}
        </Alert>
      )}

      {open && (
        <form onSubmit={submit} className="space-y-4 rounded-md border border-ink-200 bg-surface p-5">
          <div>
            <label htmlFor="ticket-subject" className="text-body-sm font-medium text-ink-900">
              Subject
            </label>
            <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className="mt-1" />
          </div>
          <div>
            <label htmlFor="ticket-description" className="text-body-sm font-medium text-ink-900">
              What&apos;s happening?
            </label>
            <Textarea id="ticket-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={4} className="mt-1" />
          </div>
          <p className="text-caption text-ink-600">
            We&apos;ll reply to <strong className="text-ink-900">{email ?? "your sign-in email"}</strong>.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving} loadingLabel="Sending…" disabled={subject.trim().length < 3 || description.trim().length < 10}>
              Send ticket
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {tickets.length === 0 ? (
        !open && <p className="text-body-sm text-ink-500">No tickets yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Your support tickets">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-md border border-ink-200 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-body-sm font-semibold text-ink-900">
                  {t.subject}
                  <span className="ml-2 font-mono text-caption font-normal text-ink-500">{t.reference}</span>
                </p>
                <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
              </div>
              <p className="mt-1 text-caption text-ink-500">Opened {date(t.createdAt)}</p>
              <p className="mt-2 whitespace-pre-line text-body-sm text-ink-800">{t.description}</p>
              {t.adminResponse && (
                <div className="mt-3 rounded-sm bg-surface-sunken p-3 text-body-sm text-ink-800">
                  <p className="font-medium">Our reply{t.respondedAt ? ` · ${date(t.respondedAt)}` : ""}</p>
                  <p className="mt-1 whitespace-pre-line">{t.adminResponse}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

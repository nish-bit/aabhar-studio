"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminPlanView, AdminPresetView } from "@/lib/admin-types";
import { PRESET_SLUGS, PRESETS } from "@/lib/presets";

/**
 * Admin actions. These buttons are only shown to the admin role, but that
 * is a convenience: every request is authorised again on the server, and a
 * support user calling the API directly gets 403.
 */

async function send(url: string, method: "POST" | "PUT", body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  return json;
}

interface ActionDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields; read them in onSubmit from the FormData. */
  children?: React.ReactNode;
  onSubmit: (form: FormData, reason: string) => Promise<string | void>;
  open: boolean;
  setOpen: (o: boolean) => void;
}

/** A confirm dialog that always asks why — the reason goes into the audit log. */
function ActionDialog({ trigger, title, description, confirmLabel, destructive, children, onSubmit, open, setOpen }: ActionDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const descId = useId();
  const reasonId = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      {trigger}
      <DialogContent aria-describedby={descId}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const reason = String(form.get("reason") ?? "").trim();
            if (reason.length < 5) {
              setError("Give a reason of at least 5 characters. It's stored in the audit log.");
              return;
            }
            setError(null);
            startTransition(async () => {
              try {
                await onSubmit(form, reason);
                setOpen(false);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong.");
              }
            });
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription id={descId}>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-body-sm font-medium text-ink-900">
              Reason <span className="font-normal text-ink-600">(required, stored in the audit log)</span>
            </label>
            <textarea
              id={reasonId}
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              className="w-full rounded-sm border border-ink-300 bg-surface p-2 text-body-sm text-ink-900 focus-visible:border-gold-600"
            />
          </div>
          {error && (
            <Alert tone="error" live="assertive">
              {error}
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "primary"} disabled={pending} aria-busy={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const field = "h-10 w-full rounded-sm border border-ink-300 bg-surface px-2 text-body-sm text-ink-900 focus-visible:border-gold-600";
const num = (form: FormData, k: string) => Number(form.get(k));

/* -------------------------------------------------------------- users */

export function DisableUserButton({ userId, email, disabled }: { userId: string; email: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant={disabled ? "secondary" : "destructive"} size="sm" onClick={() => setOpen(true)}>
          {disabled ? "Re-enable account" : "Disable account"}
        </Button>
      }
      title={disabled ? "Re-enable this account?" : "Disable this account?"}
      description={
        disabled
          ? `${email ?? "This user"} will be able to sign in and use the app again.`
          : `${email ?? "This user"} will be blocked from every API and page immediately and signed out at the auth provider. Payments and data are kept; subscriptions are not cancelled automatically.`
      }
      confirmLabel={disabled ? "Re-enable" : "Disable account"}
      destructive={!disabled}
      onSubmit={async (_f, reason) => {
        await send(`/api/admin/users/${userId}/status`, "POST", { disabled: !disabled, reason });
      }}
    />
  );
}

export function GrantCreditsButton({ shopId, shopName }: { shopId: string; shopName: string | null }) {
  const [open, setOpen] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const amountId = useId();
  const expId = useId();
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Grant credits
        </Button>
      }
      title="Grant promotional credits"
      description={`Adds credits to ${shopName ?? "this shop"}. The customer sees “Promotional credits” in their history; your reason stays internal.`}
      confirmLabel="Grant credits"
      onSubmit={async (form, reason) => {
        const days = String(form.get("expiresInDays") ?? "");
        await send("/api/admin/credits/grants", "POST", {
          shopId,
          amount: num(form, "amount"),
          expiresInDays: days === "" ? null : Number(days),
          reason,
          // One key per dialog: a double-click or retry can't grant twice.
          idempotencyKey: key,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={amountId} className="text-body-sm font-medium text-ink-900">
            Credits (1–10,000)
          </label>
          <input id={amountId} name="amount" type="number" min={1} max={10000} required defaultValue={10} className={field} />
        </div>
        <div className="space-y-1">
          <label htmlFor={expId} className="text-body-sm font-medium text-ink-900">
            Expires after (days)
          </label>
          <input id={expId} name="expiresInDays" type="number" min={1} max={3650} defaultValue={90} className={field} aria-describedby={`${expId}-h`} />
          <p id={`${expId}-h`} className="text-caption text-ink-600">
            Leave empty for no expiry.
          </p>
        </div>
      </div>
    </ActionDialog>
  );
}

/* --------------------------------------------------------------- jobs */

export function RetryJobButton({ jobId, eligible, why }: { jobId: string; eligible: boolean; why: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (!eligible) return <p className="text-body-sm text-ink-600">{why}</p>;
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button size="sm" onClick={() => setOpen(true)}>
          Retry job
        </Button>
      }
      title="Retry this generation?"
      description={why}
      confirmLabel="Retry"
      onSubmit={async (_f, reason) => {
        const r = (await send(`/api/admin/jobs/${jobId}/retry`, "POST", { reason })) as { jobId: string };
        router.push(`/admin/jobs/${r.jobId}`);
      }}
    />
  );
}

/* ------------------------------------------------------- configuration */

export function PlanEditButton({ plan }: { plan: AdminPlanView }) {
  const [open, setOpen] = useState(false);
  const ids = { credits: useId(), active: useId(), daily: useId(), cats: useId(), items: useId() };
  const allPresets = plan.limits.presets === "all";
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
      }
      title={`Edit ${plan.name} limits`}
      description="Applies immediately to every shop on this plan and to the public pricing page. Prices can't be changed here — they're Razorpay Plans (see docs/BILLING.md)."
      confirmLabel="Save plan"
      onSubmit={async (form, reason) => {
        const chosen = PRESET_SLUGS.filter((s) => form.get(`preset-${s}`) === "on");
        await send(`/api/admin/plans/${plan.id}`, "PUT", {
          monthlyCredits: plan.isPaid ? num(form, "monthlyCredits") : plan.monthlyCredits,
          limits: {
            maxActiveJobs: num(form, "maxActiveJobs"),
            dailyGenerations: num(form, "dailyGenerations"),
            maxCatalogues: num(form, "maxCatalogues"),
            maxCatalogueItems: num(form, "maxCatalogueItems"),
            presets: chosen.length === PRESET_SLUGS.length ? "all" : chosen,
          },
          reason,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {plan.isPaid ? (
          <NumberField id={ids.credits} name="monthlyCredits" label="Credits per month" min={1} max={100000} value={plan.monthlyCredits} />
        ) : (
          <p className="text-caption text-ink-600 sm:col-span-2">Trial credits are set under Trial below.</p>
        )}
        <NumberField id={ids.active} name="maxActiveJobs" label="Running at once" min={1} max={20} value={plan.limits.maxActiveJobs} />
        <NumberField id={ids.daily} name="dailyGenerations" label="Generations per day" min={1} max={10000} value={plan.limits.dailyGenerations} />
        <NumberField id={ids.cats} name="maxCatalogues" label="Catalogues" min={0} max={1000} value={plan.limits.maxCatalogues} />
        <NumberField id={ids.items} name="maxCatalogueItems" label="Products per catalogue" min={1} max={100} value={plan.limits.maxCatalogueItems} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-body-sm font-medium text-ink-900">Styles included</legend>
        <div className="grid grid-cols-2 gap-1">
          {PRESET_SLUGS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-body-sm text-ink-800">
              <input type="checkbox" name={`preset-${s}`} defaultChecked={allPresets || (plan.limits.presets as string[]).includes(s)} className="size-4" />
              {PRESETS[s].name}
            </label>
          ))}
        </div>
      </fieldset>
    </ActionDialog>
  );
}

export function PlanResetButton({ planId, name }: { planId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Reset
        </Button>
      }
      title={`Reset ${name} to the configured values?`}
      description="Removes the dashboard override; the values in src/config/billing.ts apply again."
      confirmLabel="Reset plan"
      onSubmit={async (_f, reason) => {
        await send(`/api/admin/plans/${planId}/reset`, "POST", { reason });
      }}
    />
  );
}

export function TrialEditButton({ credits, validityDays }: { credits: number; validityDays: number }) {
  const [open, setOpen] = useState(false);
  const a = useId();
  const b = useId();
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Edit trial
        </Button>
      }
      title="Edit the free trial"
      description="Applies to new sign-ups only. Existing trial credits keep their amount and expiry."
      confirmLabel="Save trial"
      onSubmit={async (form, reason) => {
        await send("/api/admin/trial", "PUT", { credits: num(form, "credits"), validityDays: num(form, "validityDays"), reason });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField id={a} name="credits" label="Trial credits" min={0} max={1000} value={credits} />
        <NumberField id={b} name="validityDays" label="Valid for (days)" min={1} max={3650} value={validityDays} />
      </div>
    </ActionDialog>
  );
}

export function PresetEditButton({ preset }: { preset: AdminPresetView }) {
  const [open, setOpen] = useState(false);
  const costId = useId();
  return (
    <ActionDialog
      open={open}
      setOpen={setOpen}
      trigger={
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
      }
      title={`Edit ${preset.name}`}
      description="Switched-off styles disappear from the studio for new generations. Jobs already running are unaffected. Prompts are changed in code, not here."
      confirmLabel="Save style"
      onSubmit={async (form, reason) => {
        await send(`/api/admin/presets/${preset.slug}`, "PUT", { enabled: form.get("enabled") === "on", creditCost: num(form, "creditCost"), reason });
      }}
    >
      <label className="flex items-center gap-2 text-body-sm text-ink-900">
        <input type="checkbox" name="enabled" defaultChecked={preset.enabled} className="size-4" />
        Available to customers
      </label>
      <NumberField id={costId} name="creditCost" label={`Credits per image (default ${preset.defaultCreditCost})`} min={1} max={10} value={preset.creditCost} />
    </ActionDialog>
  );
}

function NumberField({ id, name, label, min, max, value }: { id: string; name: string; label: string; min: number; max: number; value: number }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-body-sm font-medium text-ink-900">
        {label}
      </label>
      <input id={id} name={name} type="number" min={min} max={max} required defaultValue={value} className={field} />
    </div>
  );
}

/* ------------------------------------------------- refund requests */

/** Approve (returns the credits) or reject a customer's refund request. The reason is shown to the customer. */
export function RefundDecisionButtons({ id, credits }: { id: string; credits: number }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const decide = (decision: "approved" | "rejected") => async (_form: FormData, reason: string) => {
    await send(`/api/admin/refund-requests/${id}`, "POST", { decision, note: reason });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        open={approveOpen}
        setOpen={setApproveOpen}
        trigger={
          <Button size="sm" onClick={() => setApproveOpen(true)}>
            Approve · return {credits} {credits === 1 ? "credit" : "credits"}
          </Button>
        }
        title="Approve this refund request?"
        description={`${credits} ${credits === 1 ? "credit goes" : "credits go"} back to the customer's balance (valid 12 months). The reason below is shown to the customer and kept in the audit log.`}
        confirmLabel="Approve and return credits"
        onSubmit={decide("approved")}
      />
      <ActionDialog
        open={rejectOpen}
        setOpen={setRejectOpen}
        trigger={
          <Button size="sm" variant="secondary" onClick={() => setRejectOpen(true)}>
            Reject
          </Button>
        }
        title="Reject this refund request?"
        description="No credits are returned. The reason below is shown to the customer and kept in the audit log, so explain what you saw."
        confirmLabel="Reject request"
        destructive
        onSubmit={decide("rejected")}
      />
    </div>
  );
}

/* --------------------------------------------------- support tickets */

/** Reply to a ticket and set its status. The reply is shown to the customer on their Plans page. */
export function TicketReplyForm({ id, status, response }: { id: string; status: "open" | "answered" | "closed"; response: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(response ?? "");
  const [next, setNext] = useState<"open" | "answered" | "closed">(status === "open" ? "answered" : status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textId = useId();
  const statusId = useId();
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            await send(`/api/admin/support-tickets/${id}`, "POST", { response: text.trim() === (response ?? "").trim() ? "" : text.trim(), status: next });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
          }
        });
      }}
    >
      <label htmlFor={textId} className="text-caption font-medium text-ink-700">
        Reply (shown to the customer; email them too, since there&apos;s no email provider yet)
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        rows={3}
        className="w-full rounded-sm border border-ink-300 bg-surface p-2 text-body-sm text-ink-900 focus-visible:border-gold-600"
      />
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={statusId} className="flex flex-col gap-1 text-caption font-medium text-ink-700">
          Status
          <select
            id={statusId}
            value={next}
            onChange={(e) => setNext(e.target.value as typeof next)}
            className="h-9 rounded-sm border border-ink-300 bg-canvas px-2 text-body-sm text-ink-900"
          >
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <Button type="submit" size="sm" loading={pending} loadingLabel="Saving…">
          Save
        </Button>
      </div>
      {error && (
        <Alert tone="error" live="assertive">
          {error}
        </Alert>
      )}
    </form>
  );
}

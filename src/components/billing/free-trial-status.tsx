import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FreeTrialView } from "@/lib/billing-types";
import { cn } from "@/lib/utils";

/**
 * "Free Trial: 1 / 2 generations remaining". The numbers come from the
 * account's trial credit grant on the server; the server also enforces it
 * (a generation without credits is refused). When the trial is used up and
 * no purchased credits are left, it says so and links to Plans.
 *
 * `balance` is the live credit balance: a trial-only account's remaining
 * free generations can't exceed it, so the line stays right after each
 * generation without a reload.
 */
export function FreeTrialStatus({ trial, balance, className }: { trial: FreeTrialView | null; balance: number; className?: string }) {
  if (!trial) return null;
  const remaining = Math.max(0, Math.min(trial.remaining, balance));
  const ended = remaining === 0;
  const blocked = ended && balance < 1;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between",
        blocked ? "border-warning-border bg-warning-bg" : "border-gold-200 bg-gold-50",
        className,
      )}
    >
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden />
        <div>
          <p className="text-body-sm font-semibold text-ink-900">
            {ended ? (
              `Free Trial ${trial.expired ? "expired" : "exhausted"}`
            ) : (
              <>
                Free Trial: <span className="tabular">{remaining} / {trial.total}</span> generations remaining
              </>
            )}
          </p>
          {blocked ? (
            <p className="mt-0.5 text-body-sm text-ink-700">
              {trial.expired
                ? "Your free trial has expired. Purchase a credit package to continue creating catalogue images."
                : `You have used your ${trial.total} free AI image generations. Purchase a credit package to continue creating catalogue images.`}
            </p>
          ) : ended ? (
            <p className="mt-0.5 text-body-sm text-ink-700">Free trial used. New images use your purchased credits.</p>
          ) : (
            <p className="mt-0.5 text-body-sm text-ink-700">
              Each free generation uses one of the essential styles. Failed images don&apos;t count.
            </p>
          )}
        </div>
      </div>
      {blocked && (
        <Button asChild size="sm" className="shrink-0">
          <Link href="/app/billing">Buy Credits</Link>
        </Button>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Container } from "@/components/shared/container";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where the unsubscribe link in marketing emails lands. No sign-in needed.
 * The user confirms with one button (a plain form POST, works without
 * JavaScript); opening the link alone changes nothing, so email security
 * scanners that open links can't unsubscribe people by accident.
 */
export default function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Container width="narrow" className="py-12 md:py-16">
      <h1 className="font-serif text-display-md font-medium text-ink-900">Marketing emails</h1>
      <div className="mt-6 max-w-xl">
        <Suspense fallback={<div className="h-32 animate-pulse rounded-md bg-surface-sunken" aria-busy="true" />}>
          <Body searchParams={searchParams} />
        </Suspense>
      </div>
    </Container>
  );
}

async function Body({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : null;
  const token = typeof sp.token === "string" ? sp.token : null;

  if (status === "done") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="You're unsubscribed">
          We won&apos;t send you marketing emails, product updates, offers or newsletters any more. Your Aabhar Studio account, credits and
          catalogues are not affected.
        </Alert>
        <p className="text-body-sm text-ink-600">
          Changed your mind? Sign in and turn marketing emails back on under{" "}
          <Link href="/app/settings/account" className="text-gold-700 underline underline-offset-2">
            Account
          </Link>
          .
        </p>
      </div>
    );
  }
  if (status === "invalid" || status === "error" || !token) {
    return (
      <div className="space-y-4">
        <Alert tone="error" live="assertive" title={status === "error" ? "Something went wrong" : "This link isn't valid"}>
          {status === "error"
            ? "We couldn't update your preference just now. Please try the link again in a few minutes."
            : "The unsubscribe link may be incomplete. Copy the full link from the email, or sign in and change your preference under Account."}
        </Alert>
        <Button asChild variant="secondary">
          <Link href="/app/settings/account">Go to account settings</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action="/api/marketing/unsubscribe" method="post" className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-body text-ink-800">
        Stop receiving marketing emails, product updates, offers and newsletters from Aabhar Studio? Your account, credits and
        catalogues stay as they are.
      </p>
      <Button type="submit" size="lg">
        Unsubscribe
      </Button>
    </form>
  );
}

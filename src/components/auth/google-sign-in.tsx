"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loginErrorMessage, oauthCallbackUrl, signInPurpose } from "@/lib/auth-flow";
import { MARKETING_CONSENT, SIGNUP_CONSENT_COOKIE } from "@/lib/marketing";
import { safeNextPath } from "@/lib/safe-redirect";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Google sign-in through Supabase Auth (PKCE). Supabase sends the browser to
 * Google's account chooser; Google returns to /auth/callback, which finishes
 * sign-in on the server. New and returning users use the same button.
 */
export function GoogleSignIn() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const purpose = signInPurpose(params.get("next"));
  const [busy, setBusy] = React.useState(false);
  // Marketing consent is optional and starts unticked; signing in works either way.
  const [marketing, setMarketing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(() => loginErrorMessage(params.get("error")));

  // Coming back with the browser's Back button restores this page from cache: clear the spinner.
  React.useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const signIn = async () => {
    const supabase = supabaseBrowser();
    if (!supabase) {
      // The NEXT_PUBLIC_SUPABASE_* values are compiled into the browser bundle at build time.
      // Without them the button can't start sign-in; say so instead of silently doing nothing.
      setError(loginErrorMessage("unavailable"));
      return;
    }
    setBusy(true);
    setError(null);
    rememberMarketingChoice(marketing);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthCallbackUrl(window.location.origin, next),
        // Always show Google's account chooser, so shared shop computers don't silently reuse an account.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      setError(loginErrorMessage("failed"));
    }
    // On success the browser is already navigating to Google; keep the spinner.
  };

  return (
    <div className="space-y-4">
      {purpose && <p className="rounded-sm border border-gold-200 bg-gold-50 px-3 py-2 text-body-sm text-ink-800">{purpose}</p>}
      {error && (
        <Alert tone="error" live="assertive">
          {error}
        </Alert>
      )}
      <Button type="button" size="lg" variant="secondary" className="w-full gap-3" loading={busy} loadingLabel="Opening Google…" onClick={signIn}>
        <GoogleMark />
        Continue with Google
      </Button>
      <label className="flex items-start gap-3 text-body-sm text-ink-700">
        <input
          type="checkbox"
          name="marketing"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--ink-900)]"
        />
        <span>
          {MARKETING_CONSENT.text} <span className="text-ink-500">(Optional)</span>
        </span>
      </label>
    </div>
  );
}

/**
 * Google sign-in leaves this site, so the checkbox travels to /auth/callback
 * in a short-lived first-party cookie, which records it once the user is
 * known. Unticked clears any earlier choice.
 */
function rememberMarketingChoice(agreed: boolean) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const value = agreed ? `${MARKETING_CONSENT.version}; Max-Age=900` : "; Max-Age=0";
  document.cookie = `${SIGNUP_CONSENT_COOKIE}=${value}; Path=/auth/callback; SameSite=Lax${secure}`;
}

/** Google's standard multicolour "G" mark, as required by Google's sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

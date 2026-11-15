"use client";

import * as React from "react";

/**
 * True when this submit should go ahead: the first one only. Later submits
 * (double clicks, Enter held down) are dropped while the first is in flight.
 */
export function acceptSignOutSubmit(state: { submitting: boolean }): boolean {
  if (state.submitting) return false;
  state.submitting = true;
  return true;
}

/**
 * The "Sign out" form: a plain same-site POST to /auth/sign-out (works without
 * JavaScript), submitted at most once. The button is disabled while the request
 * is in flight. Coming back to the page from the browser's back/forward cache
 * re-enables it.
 */
export function SignOutForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const state = React.useRef({ submitting: false });
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      state.current.submitting = false;
      setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form
      action="/auth/sign-out"
      method="post"
      className={className}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        if (!acceptSignOutSubmit(state.current)) {
          e.preventDefault();
          return;
        }
        setPending(true);
      }}
    >
      {/* `contents` keeps the layout identical; disabling the fieldset disables the button inside. */}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}

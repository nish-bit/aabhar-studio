import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { Logo } from "@/components/shared/logo";
import { IntegrationNotice } from "@/components/studio/integration-notice";
import { freeImagesMessage } from "@/config/plans";
import { brand } from "@/content/marketing";
import { getPublicPricing } from "@/server/billing/public-pricing";
import { integrationStatus } from "@/server/env";

export const metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  // Render per request, not at build time: whether sign-in is configured depends on the
  // runtime environment (on Cloudflare, SUPABASE_SECRET_KEY is a Worker secret that a
  // Workers Builds build never sees, so a prerendered page always said "not connected").
  await connection();
  const { supabase } = integrationStatus();
  const { pricing } = await getPublicPricing();
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <Logo name={brand.name} />
        <h1 className="mt-8 font-serif text-display-md font-medium text-ink-900">Welcome to Your Jewellery Studio</h1>
        <p className="mt-2 text-body text-ink-600">Sign in to create professional jewellery photos and catalogues.</p>
        <div className="mt-8">
          {supabase ? (
            <Suspense>
              <GoogleSignIn />
            </Suspense>
          ) : (
            <IntegrationNotice title="Sign-in not connected">
              Add the Supabase environment variables to enable sign-in. See <code>docs/AUTH_AND_PURCHASE.md</code>.
            </IntegrationNotice>
          )}
        </div>
        <p className="mt-6 text-body-sm text-ink-600">New here? {freeImagesMessage(pricing.trialCredits)} Signing in with Google creates your account. We never see your Google password.</p>
        <p className="mt-8 text-caption text-ink-600">
          Google shares your name, email address and profile picture with us, and we use them only for your account. By continuing you agree to our{" "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink-900">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink-900">
            Privacy Policy
          </Link>
          .
        </p>
        <nav aria-label="More" className="mt-4 flex gap-4 text-body-sm">
          <Link href="/pricing" className="text-gold-700 underline underline-offset-2">
            See pricing
          </Link>
          <Link href="/" className="text-gold-700 underline underline-offset-2">
            Back to home
          </Link>
        </nav>
      </div>
    </main>
  );
}

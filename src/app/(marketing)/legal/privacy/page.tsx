import type { Metadata } from "next";
import Link from "next/link";

import { Fill, LegalPage } from "@/components/marketing/legal-page";
import { brand } from "@/content/marketing";
import { RETENTION } from "@/server/privacy/retention";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * Draft privacy policy. Every factual statement below describes what the
 * code actually does (see docs/PRIVACY.md); placeholders are for the owner.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="Draft, October 2026">
      <p>
        This policy explains what <Fill>legal business name</Fill> (“we”) collects when you use Aabhar Studio, why, who processes it for
        us, how long we keep it, and how to ask for it to be deleted. Contact:{" "}
        <a className="underline" href={`mailto:${brand.supportEmail}`}>
          {brand.supportEmail}
        </a>
        .
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> when you sign in with Google, Google shares your email address, name and profile picture with us. We use them to identify your account. We never see your Google password.</li>
        <li><strong>Business details you enter:</strong> business name, logo, phone, WhatsApp, email, website and address, used on your catalogues.</li>
        <li><strong>Photos you upload:</strong> we re-encode every photo and remove its metadata (including camera details and location) before storing it. The file as uploaded is deleted once checked.</li>
        <li><strong>Results and catalogues:</strong> edited images, the notes you add to a request, and catalogue content you type (names, SKUs, prices, specifications).</li>
        <li><strong>Payments:</strong> handled by Razorpay. We receive and keep the payment reference, amount, status and method type (for example “card” or “upi”). We never receive or store card numbers.</li>
        <li><strong>Marketing emails (optional):</strong> only if you tick the box when signing in, or turn it on under Account, we record that you agreed, when, where (sign-in page or settings) and which wording you saw, and use your sign-in email to send occasional product updates, offers and newsletters. Not agreeing doesn&apos;t limit the service. If you unsubscribe, we record when.</li>
        <li><strong>Usage records:</strong> credits used, generations and their status, needed to run and bill the service.</li>
        <li><strong>Cookies:</strong> only the sign-in session cookies needed to keep you signed in, and a short-lived cookie (up to 15 minutes) that carries your marketing-email choice through Google sign-in. No advertising or analytics cookies.</li>
      </ul>

      <h2>Who processes your data for us</h2>
      <ul>
        <li><strong>Google</strong> — sign-in (Google account verification).</li>
        <li><strong>Supabase</strong> — sign-in, database and private file storage (region: <Fill>Supabase project region</Fill>).</li>
        <li><strong>OpenAI</strong> — your photo and any notes are sent to OpenAI&apos;s image API to create the edited image, under OpenAI&apos;s API data terms <Fill>confirm OpenAI API retention terms for your account</Fill>.</li>
        <li><strong>Razorpay</strong> — payments and subscriptions.</li>
        <li><strong>Vercel</strong> — hosting (request logs).</li>
      </ul>
      <p>Your photos are private to your shop. We don&apos;t sell personal data or use your photos to advertise.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Photos uploaded but never finished: deleted after {RETENTION.pendingUploadHours} hours.</li>
        <li>Results you discard: deleted after {RETENTION.discardedResultDays} days.</li>
        <li>Catalogue PDFs and image ZIPs you export: deleted after {RETENTION.exportDays} days (you can export again at any time).</li>
        <li>Catalogues you delete: recoverable for {RETENTION.deletedCatalogueDays} days, then deleted.</li>
        <li>Payment notifications from Razorpay: contact details removed after {RETENTION.webhookPayloadDays} days.</li>
        <li>Your other photos, results and catalogues: kept while your account is active, until you delete them or ask us to delete your account.</li>
        <li>Payment and invoice records: kept for <Fill>period required by Indian tax law</Fill> even after account deletion.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <p>
        You can correct your business details in the app at any time. To get a copy of your data, or to have your account and content deleted,
        email{" "}
        <a className="underline" href={`mailto:${brand.supportEmail}`}>
          {brand.supportEmail}
        </a>
        . After verifying the request we delete your photos, results, catalogues, logo and business details,
        and replace your sign-in email; payment records are kept as described above.
      </p>
      <p>
        You can stop marketing emails at any time with the unsubscribe link in any marketing email (no sign-in needed) or under Account in
        the app. Unsubscribing doesn&apos;t affect your account, credits or catalogues. If your account is deleted, your marketing-email
        records are deleted too.
      </p>
      <p>
        Grievance officer: <Fill>name, email</Fill>. We aim to respond within <Fill>number</Fill> days.
      </p>

      <h2>Children</h2>
      <p>Aabhar Studio is for businesses and isn&apos;t intended for anyone under 18.</p>

      <h2>Changes</h2>
      <p>
        We&apos;ll update this page and the date above if this policy changes. See also our <Link className="underline" href="/legal/terms">terms</Link>.
      </p>
    </LegalPage>
  );
}

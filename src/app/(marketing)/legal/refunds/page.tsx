import type { Metadata } from "next";

import { Fill, LegalPage } from "@/components/marketing/legal-page";
import { JsonLd } from "@/components/seo/json-ld";
import { pageMetadata } from "@/lib/site";
import { breadcrumbSchema, graph } from "@/lib/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Refund and cancellation policy",
  description: "Aabhar Studio's refund and cancellation policy for credit purchases, failed generations and refunded credits.",
  path: "/legal/refunds",
});

const SUPPORT_EMAIL = "aabharstudio@gmail.com";

/**
 * Draft refund and cancellation policy, as supplied by the business. The
 * statements about cancellation, failed generations and refunded credits
 * match what the billing code does (src/server/billing/service.ts).
 */
export default function RefundsPage() {
  const email = (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
      {SUPPORT_EMAIL}
    </a>
  );
  return (
    <LegalPage title="Refund and cancellation policy" updated="November 2026 (draft, pending business approval and legal review)">
      <JsonLd data={graph(breadcrumbSchema("Refund and cancellation policy", "/legal/refunds"))} />
      <p>
        Welcome to Aabhar Studio. This policy explains how subscription cancellations, failed image generations, and payment refunds are
        handled.
      </p>

      <h2>1. Subscription cancellation</h2>
      <p>You can cancel your subscription at any time through the Plan and billing section of your Aabhar Studio account.</p>
      <p>After cancellation:</p>
      <ul>
        <li>Your subscription will not automatically renew.</li>
        <li>You can continue using your paid plan until the end of the current billing period.</li>
        <li>Any remaining plan benefits will remain available until the applicable expiry date.</li>
        <li>Cancellation does not automatically initiate a refund for a previous payment.</li>
      </ul>

      <h2>2. Failed image generations</h2>
      <p>We aim to provide a reliable AI jewellery photography experience.</p>
      <p>If an image generation fails due to a technical error:</p>
      <ul>
        <li>The credits deducted for that failed generation will be returned to your account automatically, where the failure is confirmed by our system.</li>
        <li>You can check your available credits in your account dashboard.</li>
        <li>If credits are not restored automatically, contact our support team with the generation details.</li>
      </ul>
      <p>Successful image generations are not eligible for automatic credit restoration merely because the result does not meet personal preferences.</p>

      <h2>3. Payment refunds</h2>
      <p>Refund eligibility depends on the nature of the transaction, the reason for the request, and applicable consumer protection laws.</p>
      <ul>
        <li>Eligible refund circumstances: <Fill>specify when refunds are offered</Fill></li>
        <li>Refund request deadline: <Fill>number of days after payment</Fill></li>
        <li>Expected processing time: <Fill>approved processing period</Fill></li>
        <li>Non-refundable purchases or circumstances: <Fill>applicable exclusions</Fill></li>
      </ul>
      <p>Approved refunds will be processed through the original payment method wherever supported.</p>
      <p>
        Where a refund is issued for a credit purchase, the corresponding unused credits may be deducted from the account. Credits already
        consumed through successful generations cannot simply be restored as unused credits. Any adjustment will be handled consistently
        with applicable law and the approved refund terms.
      </p>

      <h2>4. How to request a refund</h2>
      <p>To request a refund or report a billing issue:</p>
      <ol className="list-decimal pl-6 [&_li]:mt-1.5">
        <li>Email our support team at {email}.</li>
        <li>Include your registered Aabhar Studio email address.</li>
        <li>Provide the payment reference or transaction ID from your billing history.</li>
        <li>Briefly explain the reason for your request.</li>
      </ol>
      <p>Our team will review your request and communicate the outcome.</p>

      <h2>5. Contact information</h2>
      <p>
        <strong>Aabhar Studio</strong>
        <br />
        AI-powered jewellery photography and catalogue creation.
      </p>
      <ul>
        <li>Business address: New Delhi <Fill>full registered address</Fill></li>
        <li>Support email: {email}</li>
      </ul>

      <p>This policy is a draft and will become effective only after business approval and legal review.</p>
    </LegalPage>
  );
}

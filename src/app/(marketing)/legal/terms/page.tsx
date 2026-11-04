import type { Metadata } from "next";
import Link from "next/link";

import { Fill, LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Terms and conditions" };

const SUPPORT_EMAIL = "aabharstudio@gmail.com";

const SECTIONS = [
  ["acceptance", "Acceptance of Terms"],
  ["account", "Account & Eligibility"],
  ["service", "The Service"],
  ["credits", "Credits, Pricing & Payments"],
  ["refunds", "Refunds & Cancellations"],
  ["content", "Your Content & Ownership"],
  ["acceptable-use", "Acceptable Use"],
  ["ip", "Intellectual Property"],
  ["ai-content", "AI-Generated Content Disclaimer"],
  ["warranties", "Disclaimer of Warranties"],
  ["liability", "Limitation of Liability"],
  ["termination", "Suspension & Termination"],
  ["law", "Governing Law"],
  ["contact", "Contact"],
] as const;

const linkCls = "underline underline-offset-2";

/** Section heading with an anchor for the "On this page" list. */
function H({ id }: { id: (typeof SECTIONS)[number][0] }) {
  const i = SECTIONS.findIndex(([s]) => s === id);
  return (
    <h2 id={id} className="scroll-mt-24">
      {i + 1}. {SECTIONS[i]![1]}
    </h2>
  );
}

/**
 * Draft terms and conditions, as supplied by the business. Statements about
 * credits, payments, cancellation and failed generations match what the
 * billing code does.
 */
export default function TermsPage() {
  const email = (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={linkCls}>
      {SUPPORT_EMAIL}
    </a>
  );
  const privacy = (
    <Link href="/legal/privacy" className={linkCls}>
      Privacy Policy
    </Link>
  );
  const refunds = (
    <Link href="/legal/refunds" className={linkCls}>
      Refund and Cancellation Policy
    </Link>
  );

  return (
    <LegalPage title="Terms and conditions" updated="1 November 2026 (draft, subject to legal review and business approval)">
      <p>
        These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your access to and use of Aabhar Studio (&ldquo;Service&rdquo;), operated by
        Aabhar Studio (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
      </p>
      <p>
        By creating an account, purchasing credits, subscribing to a plan, or using our Service, you agree to these Terms and our {privacy}. If
        you do not agree, please do not use the Service.
      </p>

      <nav aria-labelledby="toc-title" className="rounded-md border border-ink-200 bg-surface p-4">
        <p id="toc-title" className="text-body-sm font-semibold text-ink-900">
          On this page
        </p>
        <ol className="mt-2 grid list-decimal gap-x-8 pl-6 text-body-sm sm:grid-cols-2 [&_li]:mt-1">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-gold-700 underline-offset-2 hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <H id="acceptance" />
      <p>By registering, accessing, or using Aabhar Studio, you confirm that you have read, understood, and agreed to these Terms and our {privacy}.</p>
      <p>You must not use the Service if you do not agree to these Terms.</p>

      <H id="account" />
      <p>You must be at least 18 years old and legally capable of entering into a binding agreement to use the Service.</p>
      <p>You are responsible for:</p>
      <ul>
        <li>Providing accurate registration information.</li>
        <li>Maintaining the security of your account credentials.</li>
        <li>All activities performed through your account.</li>
        <li>Informing us of unauthorized access to your account.</li>
      </ul>
      <p>You must not share, sell, or transfer your account without our written permission.</p>

      <H id="service" />
      <p>Aabhar Studio provides AI-powered jewellery photography and catalogue image generation services.</p>
      <p>Depending on your subscription and available features, the Service may include:</p>
      <ul>
        <li>Jewellery image enhancement and transformation.</li>
        <li>AI-generated product photography.</li>
        <li>Background and visual-style transformations.</li>
        <li>Image downloads and generation history.</li>
        <li>Credit-based image generation.</li>
        <li>Subscription-based services.</li>
      </ul>
      <p>Features may change, improve, or be discontinued as the platform develops. We will make reasonable efforts to communicate material changes.</p>

      <H id="credits" />
      <p>Aabhar Studio uses a credit-based system for certain services.</p>
      <ul>
        <li>Credits are used to access eligible image-generation features.</li>
        <li>Credit consumption depends on the applicable generation type and pricing configuration.</li>
        <li>Credits are personal to your account and cannot be transferred or resold.</li>
        <li>Free credits, paid credits, and subscription credits may have different validity conditions.</li>
        <li>Prices and applicable taxes will be displayed during checkout.</li>
        <li>Payments are processed through authorized third-party payment providers, including Razorpay where enabled.</li>
        <li>We do not intend to store your complete card or UPI payment credentials.</li>
        <li>A successful payment must be verified before corresponding credits or subscription benefits are granted.</li>
      </ul>
      <p>The specific credit allocations, expiry conditions, and subscription benefits shown in your account or at checkout apply to your purchase.</p>

      <H id="refunds" />
      <p>Subscription cancellations and payment refunds are governed by our separate {refunds}.</p>
      <p>In general:</p>
      <ul>
        <li>You may cancel eligible subscriptions through your account billing settings.</li>
        <li>Cancellation stops future renewals according to the applicable billing terms.</li>
        <li>Existing paid access may continue until the end of the current billing period.</li>
        <li>Credits for confirmed failed image generations are restored according to our credit-restoration process.</li>
        <li>Refund eligibility depends on the transaction, applicable policy, and applicable law.</li>
      </ul>
      <p>Please read our {refunds} before making a purchase.</p>

      <H id="content" />
      <p>You retain ownership of the original jewellery photographs and other materials you upload, subject to third-party rights.</p>
      <p>
        You grant Aabhar Studio a limited, non-exclusive licence to access, store, process, and use uploaded content only as reasonably
        necessary to:
      </p>
      <ul>
        <li>Provide image-generation services.</li>
        <li>Process your requests.</li>
        <li>Maintain and secure the platform.</li>
        <li>Provide technical support where necessary.</li>
      </ul>
      <p>Subject to applicable law and third-party rights, you may use generated outputs for your business and marketing purposes.</p>
      <p>
        You are responsible for ensuring that you have the necessary rights and permissions to upload photographs, trademarks, product images,
        and other materials.
      </p>

      <H id="acceptable-use" />
      <p>You agree not to:</p>
      <ul>
        <li>Upload content that you do not have permission to use.</li>
        <li>Violate intellectual property or privacy rights.</li>
        <li>Generate unlawful, deceptive, defamatory, or prohibited content.</li>
        <li>Attempt to reverse engineer or extract underlying AI models.</li>
        <li>Interfere with the security or operation of the platform.</li>
        <li>Abuse free credits, promotions, or payment systems.</li>
        <li>Use the Service for unauthorized scraping or competing services.</li>
      </ul>
      <p>We may restrict access where misuse or violations are reasonably identified.</p>

      <H id="ip" />
      <p>
        Aabhar Studio&apos;s website, software, branding, interface, designs, logos, and proprietary platform components are owned by or
        licensed to Aabhar Studio and protected by applicable intellectual property laws.
      </p>
      <p>These Terms do not transfer ownership of the platform or its underlying technology to users.</p>

      <H id="ai-content" />
      <p>Aabhar Studio uses automated AI systems to generate and transform images.</p>
      <p>You understand that:</p>
      <ul>
        <li>AI-generated images may differ from the original jewellery photograph.</li>
        <li>Generated outputs may contain visual inaccuracies.</li>
        <li>Jewellery details, gemstones, metal finishes, proportions, and colours may not always be represented perfectly.</li>
        <li>Outputs should be reviewed before being used in product catalogues, advertisements, or customer-facing materials.</li>
      </ul>
      <p>You are responsible for checking generated images before publishing or commercially using them.</p>
      <p>Aabhar Studio does not guarantee that every generated image will meet your exact creative or commercial requirements.</p>

      <H id="warranties" />
      <p>The Service is provided on an &ldquo;as available&rdquo; basis.</p>
      <p>
        We make reasonable efforts to maintain service availability and quality but do not guarantee uninterrupted access, error-free
        operation, or that every AI-generated output will satisfy a particular requirement.
      </p>
      <p>Nothing in these Terms excludes warranties or rights that cannot legally be excluded.</p>

      <H id="liability" />
      <p>
        To the extent permitted by applicable law, Aabhar Studio will not be responsible for indirect or consequential losses arising from the
        use of the Service.
      </p>
      <p>
        Nothing in these Terms limits liability where such limitation is prohibited by applicable law, including liability that cannot legally
        be excluded.
      </p>
      <p>
        <Fill>any additional limitation of liability, to be reviewed and approved before publication</Fill>
      </p>

      <H id="termination" />
      <p>You may stop using the Service and request account closure through the available account settings or by contacting our support team.</p>
      <p>We may suspend or restrict accounts where there is:</p>
      <ul>
        <li>Fraudulent activity.</li>
        <li>Payment abuse.</li>
        <li>Security threats.</li>
        <li>Serious violations of these Terms.</li>
        <li>Unlawful use of the Service.</li>
      </ul>
      <p>Where reasonably possible, we will provide notice and an opportunity to resolve the issue.</p>
      <p>Account termination and remaining credits will be handled according to applicable policies and law.</p>

      <H id="law" />
      <p>These Terms are governed by the laws of India.</p>
      <p>
        Subject to applicable law and mandatory consumer protection rights, courts of competent jurisdiction in New Delhi, India shall have
        jurisdiction over disputes arising from these Terms or use of the Service.
      </p>

      <H id="contact" />
      <p>For questions about these Terms, account-related matters, or support, contact:</p>
      <p>
        <strong>Aabhar Studio</strong>
      </p>
      <ul>
        <li>
          Website:{" "}
          <a href="https://aabharstudio.com" className={linkCls}>
            https://aabharstudio.com
          </a>
        </li>
        <li>Email: {email}</li>
        <li>Business location: New Delhi, India.</li>
        <li>
          Full business postal address and legal business entity details: <Fill>to be confirmed before publication</Fill>
        </li>
      </ul>

      <p>
        <strong>Important:</strong> This document is a draft and is not a substitute for legal advice. It will become the official Terms &amp;
        Conditions only after business approval and legal review.
      </p>
    </LegalPage>
  );
}

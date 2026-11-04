import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { brand } from "@/content/marketing";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Aabhar Studio by email or WhatsApp.",
};

const linkCls = "font-medium text-gold-700 underline underline-offset-2 hover:text-ink-900 [overflow-wrap:anywhere]";

export default function ContactPage() {
  return (
    <LegalPage title="Contact Us" updated="October 2026" draft={false}>
      <p>For any questions or support, contact us:</p>
      <ul>
        <li>
          Email:{" "}
          <a href={`mailto:${brand.supportEmail}`} className={linkCls}>
            {brand.supportEmail}
          </a>
        </li>
        {brand.supportWhatsApp && (
          <li>
            WhatsApp:{" "}
            <a href={`https://wa.me/${brand.supportWhatsApp}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
              {brand.supportWhatsAppDisplay}
            </a>
          </li>
        )}
      </ul>
    </LegalPage>
  );
}

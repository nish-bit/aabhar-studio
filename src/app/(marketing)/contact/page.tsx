import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { brand } from "@/content/marketing";
import { JsonLd } from "@/components/seo/json-ld";
import { pageMetadata } from "@/lib/site";
import { breadcrumbSchema, graph } from "@/lib/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Contact",
  description: "Contact Aabhar Studio about AI jewellery photography, credits, billing or catalogues, by email or WhatsApp.",
  path: "/contact",
});

const linkCls = "font-medium text-gold-700 underline underline-offset-2 hover:text-ink-900 [overflow-wrap:anywhere]";

export default function ContactPage() {
  return (
    <LegalPage title="Contact Us" updated="October 2026" draft={false}>
      <JsonLd data={graph(breadcrumbSchema("Contact", "/contact"))} />
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

import { billingConfig } from "@/config/billing";

/** Aabhar Studio's support inbox (the same address as the refund policy and terms). */
export const SUPPORT_EMAIL = "aabharstudio@gmail.com";

/** "Solo — image credits" → "Solo Plan"; "Starter Pack — image credits" → "Starter Pack"; anything else as recorded. */
export function planLabel(description: string): string {
  const name = description.split(" — ")[0] ?? description;
  const pack = billingConfig.packs.find((p) => p.name === name);
  if (!pack) return name;
  return /(pack|plan)$/i.test(pack.name) ? pack.name : `${pack.name} Plan`;
}

/** A mailto link for a refund email: the account email filled in, order details and reason left for the customer. */
export function refundMailto(email: string | null): string {
  const body = [
    "Hello Aabhar Studio team,",
    "",
    `Account email: ${email ?? ""}`,
    "Order details (date, plan and amount from Billing History): ",
    "Reason for the refund: ",
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Refund Request")}&body=${encodeURIComponent(body)}`;
}

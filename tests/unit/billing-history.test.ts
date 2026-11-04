import { describe, expect, it } from "vitest";

import { planLabel, refundMailto, SUPPORT_EMAIL } from "@/lib/billing-history";

describe("settings: billing history and refund email", () => {
  it("labels pack payments by plan name", () => {
    expect(planLabel("Solo — image credits")).toBe("Solo Plan");
    expect(planLabel("Signature — image credits")).toBe("Signature Plan");
    expect(planLabel("Studio — image credits")).toBe("Studio Plan");
    expect(planLabel("Starter Pack — image credits")).toBe("Starter Pack");
    expect(planLabel("50 credits — image credits")).toBe("50 credits"); // an older pack, shown as recorded
  });

  it("prefills the refund email to Aabhar Studio support, correctly encoded, without inventing order details", () => {
    const link = refundMailto("priya+shop@example.com");
    expect(link.startsWith(`mailto:${SUPPORT_EMAIL}?subject=Refund%20Request&body=`)).toBe(true);
    const body = decodeURIComponent(link.split("&body=")[1]!);
    expect(body).toContain("Account email: priya+shop@example.com");
    expect(body).toContain("Order details (date, plan and amount from Billing History): ");
    expect(body).toContain("Reason for the refund: ");
    expect(link).not.toMatch(/pay_|order_|gehnaphoto/i);
    expect(link).not.toContain(" ");
  });
});

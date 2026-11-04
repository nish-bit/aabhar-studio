import { z } from "zod";

import { billingDeps } from "@/server/billing/deps";
import { renderReceiptPdf } from "@/server/billing/receipt-document";
import { getReceiptData } from "@/server/billing/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { withUser } from "@/server/http/respond";


export const GET = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  await enforceRateLimit("receipt", user.id);
  const id = z.string().uuid().parse((await ctx.params).id);
  const data = await getReceiptData(billingDeps(), user.id, id);
  const pdf = await renderReceiptPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${data.receiptNumber.replaceAll("/", "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});

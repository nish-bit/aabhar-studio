import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { GatewayError, RazorpayGateway } from "@/server/billing/gateway";
import { renderReceiptPdf } from "@/server/billing/receipt-document";
import { verifyOrderPaymentSignature, verifyWebhookSignature } from "@/server/billing/signature";
import { readImageHeader } from "@/server/imaging/header";
import { imageProcessor } from "@/server/imaging/processor";
import { renderCataloguePdf } from "@/server/pdf/render";

/**
 * Runtime self-test for the image and PDF pipelines: runs the real code in
 * whatever runtime serves the request (Cloudflare Workers in production and
 * `wrangler dev`, Node under `next start`). No database, storage or user data.
 *
 * Disabled (404) unless SELFTEST_SECRET is set, and the request must send it
 * in `x-selftest-secret`. Set it only while testing (e.g. in .dev.vars, or
 * briefly as a Worker secret on a preview deployment), then remove it.
 */
export const dynamic = "force-dynamic";

// Tiny sample images made with sharp: a JPEG stored 96×64 with EXIF orientation 6
// (displays 64×96), a semi-transparent 80×40 PNG, and a 120×90 WebP.
const SAMPLE = {
  jpegOrientation6: "/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAGAAAAADoAQAAQAAAEAAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgAQABgAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABYBAQEBAAAAAAAAAAAAAAAAAAAFBv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK4DMrIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z",
  pngAlpha: "iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAlklEQVRoge2WUQkDQRDFTs5qioBoqPx66EEfC/kYAyFh3vPh2J2fGTzBO68ECiABdFlRBhJAM5B7l0AJE0AzkH2KJUwAXdvUEyGAro1qxhBAb7qGNAE0A9mnWMIE0LVNPREC6NqoZgwB9KZrSBNAM5B9iiVMAF3b1BMhgK6NasYQQG+6hjQBNAPZp1jCBNC1TT0R/g/wC781MQCX8+Q4AAAAAElFTkSuQmCC",
  webp: "UklGRlYAAABXRUJQVlA4IEoAAABwBQCdASp4AFoAPp1OpE4lpCOiIKgAsBOJaQoWoAEDmywDXU3uIvLANdTe4i8sA11N7iHgAP78mV/QfFy/nY9s5y84rCAAAAAAAA==",
};
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function authorised(req: Request): boolean {
  const secret = process.env.SELFTEST_SECRET;
  const sent = req.headers.get("x-selftest-secret") ?? "";
  if (!secret || secret.length < 16 || sent.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(sent), Buffer.from(secret));
}

async function check<T>(name: string, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: true as const, ms: Date.now() - started, result };
  } catch (err) {
    return {
      name,
      ok: false as const,
      ms: Date.now() - started,
      error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : String(err),
      // Code locations only (no data): this route is secret-gated and meant for debugging runtimes.
      stack: err instanceof Error ? (err.stack ?? "").split("\n").slice(1, 9).map((l) => l.trim().slice(0, 200)) : [],
    };
  }
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404 });
  const p = imageProcessor();
  const jpeg = bytes(SAMPLE.jpegOrientation6);
  const png = bytes(SAMPLE.pngAlpha);
  const webp = bytes(SAMPLE.webp);

  // ?pdf=receipt|catalogue returns the PDF this runtime produced, so it can be checked offline (e.g. with pdf.js).
  const want = new URL(req.url).searchParams.get("pdf");
  if (want === "receipt" || want === "catalogue") {
    const pdf = want === "receipt" ? await renderReceiptPdf(receiptSample()) : (await renderCataloguePdf(catalogueSample(webp, jpeg, png), "preview")).pdf;
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  }

  // Unhandled promise rejections while the checks run count as failures (the PDF and
  // image pipelines must not leave any behind), and their stacks are reported.
  const rejections: string[] = [];
  const onRejection = (reason: unknown) => {
    const stack = reason instanceof Error ? (reason.stack ?? "").split("\n").slice(1, 9).map((l) => l.trim()) : [];
    rejections.push(reason instanceof Error ? [`${reason.name}: ${reason.message}`, ...stack].join(" | ") : String(reason));
  };
  const onWorkerRejection = (e: Event) => {
    onRejection((e as unknown as { reason: unknown }).reason);
    e.preventDefault();
  };
  const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: Event) => void) => void; removeEventListener?: (t: string, f: (e: Event) => void) => void };
  g.addEventListener?.("unhandledrejection", onWorkerRejection);
  process.on?.("unhandledRejection", onRejection);

  const checks = [
    await check("header", async () => ({ jpeg: readImageHeader(jpeg), png: readImageHeader(png), webp: readImageHeader(webp) })),
    await check("orient+jpeg", async () => strip(await p.transform(jpeg, { output: { format: "jpeg", quality: 90 } }))),
    await check("fitInside", async () => strip(await p.transform(webp, { fitInside: { width: 60, height: 60 }, output: { format: "png" } }))),
    await check("cropCentre", async () => strip(await p.transform(webp, { cropCentre: { width: 90, height: 90 }, output: { format: "png" } }))),
    await check("keepAlpha", async () => {
      const out = await p.transform(png, { output: { format: "png" } });
      return { ...strip(out), hasAlpha: readImageHeader(out.bytes).hasAlpha };
    }),
    await check("flattenWhite", async () => strip(await p.transform(png, { background: "#ffffff", output: { format: "jpeg", quality: 90 } }))),
    await check("receiptPdf", async () => pdfInfo(await renderReceiptPdf(receiptSample()))),
    await check("cataloguePdf", async () => {
      const r = await renderCataloguePdf(catalogueSample(webp, jpeg, png), "preview");
      return { ...pdfInfo(r.pdf), pageCount: r.pageCount, missingImages: r.missingImageItemIds.length };
    }),
    // Razorpay signatures with fixed test values (no real secrets): node:crypto HMAC on this runtime.
    await check("razorpayHmac", async () => {
      const secret = "selftest_secret_not_real";
      const sig = createHmac("sha256", secret).update("order_SelfTest|pay_SelfTest").digest("hex");
      const body = '{"event":"payment.captured","selftest":true}';
      const results = {
        checkoutValid: verifyOrderPaymentSignature("order_SelfTest", "pay_SelfTest", sig, secret),
        checkoutTampered: verifyOrderPaymentSignature("order_SelfTest", "pay_Other", sig, secret),
        webhookValid: verifyWebhookSignature(body, createHmac("sha256", secret).update(body).digest("hex"), secret),
        webhookTampered: verifyWebhookSignature(body.replace("true", "false"), createHmac("sha256", secret).update(body).digest("hex"), secret),
        webhookMissing: verifyWebhookSignature(body, null, secret),
      };
      if (!results.checkoutValid || !results.webhookValid || results.checkoutTampered || results.webhookTampered || results.webhookMissing) {
        throw new Error(`signature checks wrong: ${JSON.stringify(results)}`);
      }
      return results;
    }),
    // The Razorpay SDK's HTTP transport on this runtime, with deliberately fake credentials:
    // Razorpay must answer 401, proving the request went out and the response came back.
    await check("razorpayTransport", async () => {
      const gw = new RazorpayGateway("rzp_test_SelfTestNotReal00", "selftest_not_a_real_secret");
      try {
        await gw.fetchPayment("pay_SelfTestNotReal00");
      } catch (err) {
        if (err instanceof GatewayError && err.statusCode === 401) return { reached: true, status: 401 };
        throw err;
      }
      throw new Error("fake credentials were accepted");
    }),
  ];
  await new Promise((r) => setTimeout(r, 100)); // let pending rejections surface
  g.removeEventListener?.("unhandledrejection", onWorkerRejection);
  process.off?.("unhandledRejection", onRejection);

  const ok = checks.every((c) => c.ok) && rejections.length === 0;
  return Response.json({ ok, processor: p.name, runtime: typeof navigator !== "undefined" ? navigator.userAgent : "unknown", checks, unhandledRejections: rejections }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}

const strip = (o: { format: string; width: number; height: number; bytes: Uint8Array }) => ({ format: o.format, width: o.width, height: o.height, bytes: o.bytes.byteLength });

function pdfInfo(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  return {
    bytes: pdf.byteLength,
    header: raw.slice(0, 5),
    trailer: raw.trimEnd().endsWith("%%EOF"),
    pages: (raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length,
    fonts: [...new Set(raw.match(/\/BaseFont\s*\/[A-Za-z0-9+-]+/g) ?? [])].map((f) => f.replace(/\/BaseFont\s*\/([A-Z]{6}\+)?/, "")),
    images: (raw.match(/\/Subtype\s*\/Image/g) ?? []).length,
  };
}

function receiptSample(): Parameters<typeof renderReceiptPdf>[0] {
  return {
    mode: "test",
    receiptNumber: "AS/SELFTEST/000001",
    issuedAt: new Date(0).toISOString(),
    payment: {
      id: "00000000-0000-4000-8000-000000000001", kind: "pack", description: "Self-test", amountPaise: 24_900, amountRefundedPaise: 0,
      status: "captured", method: "upi", errorDescription: null, creditsGranted: 3, createdAt: new Date(0).toISOString(),
      receiptAvailable: true, razorpayPaymentId: "pay_SELFTEST", capturedAt: new Date(0).toISOString(),
    },
    buyer: { name: "Self-test", email: "selftest@example.test", phone: "", address: "" },
    seller: { legalName: "", address: "", gstin: "", email: "" },
    pricesIncludeGst: true,
    gstRatePercent: 18,
  } as Parameters<typeof renderReceiptPdf>[0];
}

function catalogueSample(a: Uint8Array, b: Uint8Array, logo: Uint8Array): Parameters<typeof renderCataloguePdf>[0] {
  const item = (n: number, img: Uint8Array | null) => ({
    id: `00000000-0000-4000-8000-00000000010${n}`, name: `Sample piece ${n}`, sku: `ST-${n}`, description: "Self-test item.",
    pricePaise: 100_000 * n, specs: [], imageBytes: img,
  });
  return {
    catalogueName: "Self-test", layout: "grid", orientation: "portrait", includeCover: true, coverTitle: "Self-test",
    coverSubtitle: "Runtime check", showPrices: true, priceNote: "", includeContactPage: true,
    business: { name: "Self-test Jewellers", phone: "", whatsapp: "", email: "selftest@example.test", website: "", address: "" },
    logoBytes: logo,
    // Enough items for more than one grid page, including one unreadable image.
    items: [item(1, a), item(2, b), item(3, a), item(4, b), item(5, a), item(6, b), item(7, a), item(8, new Uint8Array([1, 2, 3]))],
  };
}

/**
 * POST: echoes the SHA-256 of the raw request body exactly as this runtime
 * delivers it to a route (webhook signatures are computed over those bytes).
 */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404 });
  const raw = await req.text();
  return Response.json({ bytes: Buffer.byteLength(raw), sha256: createHash("sha256").update(raw).digest("hex") }, { headers: { "Cache-Control": "no-store" } });
}

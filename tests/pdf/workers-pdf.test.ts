import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import * as pdfkit from "pdfkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { billingConfig } from "@/config/billing";
import { renderReceiptPdf } from "@/server/billing/receipt-document";
import { readImageHeader } from "@/server/imaging/header";
import { FONT_DATA_URLS } from "@/server/pdf/font-data.generated";
import { prepareImage } from "@/server/pdf/render";

/**
 * The PDF pipeline must run on Cloudflare Workers: no filesystem, pdfkit's
 * browser build with its built-in fonts registered, and fonts embedded as
 * data URLs. These checks pin that down on real rendered PDFs.
 */

const root = path.resolve(import.meta.dirname, "../..");
const fontDir = path.join(root, "src/server/pdf/fonts");

describe("PDF fonts", () => {
  it("embeds every .ttf in src/server/pdf/fonts, byte for byte (regenerate: node scripts/generate-pdf-font-data.mjs)", () => {
    const files = readdirSync(fontDir).filter((f) => f.endsWith(".ttf")).sort();
    expect(Object.keys(FONT_DATA_URLS).sort()).toEqual(files);
    for (const f of files) {
      const url = FONT_DATA_URLS[f]!;
      expect(url.startsWith("data:font/ttf;base64,")).toBe(true);
      expect(Buffer.from(url.split(",")[1]!, "base64").equals(readFileSync(path.join(fontDir, f)))).toBe(true);
    }
  });

  it("uses pdfkit's browser build, and the PDF code doesn't touch the filesystem", () => {
    expect(typeof (pdfkit as { registerStdFonts?: unknown }).registerStdFonts).toBe("function");
    for (const f of ["fonts.ts", "render.tsx", "catalogue-document.tsx", "pdfkit-standard-fonts.ts"]) {
      const src = readFileSync(path.join(root, "src/server/pdf", f), "utf8");
      expect(src, f).not.toMatch(/from "(node:)?(fs|path)"|process\.cwd\(\)/);
    }
  });
});

describe("receipt PDF", () => {
  it("renders a valid PDF with the bundled fonts embedded", async () => {
    const pdf = await renderReceiptPdf({
      mode: "test",
      receiptNumber: "AS/2026-27/000042",
      issuedAt: "2026-11-09T10:00:00.000Z",
      payment: {
        id: randomUUID(), kind: "pack", description: "20 credits — image credits", amountPaise: 149_900, amountRefundedPaise: 0,
        status: "captured", method: "upi", errorDescription: null, creditsGranted: 20, createdAt: "2026-11-09T09:59:00.000Z",
        receiptAvailable: true, razorpayPaymentId: "pay_WORKERS1", capturedAt: "2026-11-09T09:59:30.000Z",
      },
      buyer: { name: "Workers Test Jewellers", email: "owner@example.test", phone: "", address: "" },
      seller: billingConfig.receipts.seller,
      pricesIncludeGst: true,
      gstRatePercent: 18,
    } as Parameters<typeof renderReceiptPdf>[0]);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const raw = pdf.toString("latin1");
    const baseFonts = [...new Set(raw.match(/\/BaseFont\s*\/[A-Z]{6}\+[A-Za-z-]+/g) ?? [])].map((s) => s.split("+")[1]);
    expect(baseFonts.some((n) => n!.startsWith("Inter"))).toBe(true);
    expect(baseFonts.some((n) => n!.startsWith("CormorantGaramond"))).toBe(true);
    // Every font is an embedded subset; no unembedded built-in font slipped in.
    expect(raw).not.toMatch(/\/BaseFont\s*\/(Helvetica|Times|Courier)/);

    const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false });
    const doc = await task.promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    await task.destroy();
    expect(doc.numPages).toBe(1);
    expect(text).toContain("AS/2026-27/000042");
    expect(text).toContain("₹1,499");
  });
});

describe("catalogue images", () => {
  const box = { width: 200, height: 200 }; // points; 300 DPI print → up to 834 px

  it("turns WebP, EXIF-rotated JPEG and transparent PNG into what react-pdf can embed", async () => {
    const webp = new Uint8Array(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#b08d57" } }).webp().toBuffer());
    const rotated = new Uint8Array(
      await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#7a6a58" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    );
    const logo = new Uint8Array(await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());

    const a = await prepareImage(webp, box, "print");
    expect(a).toMatchObject({ format: "jpg", width: 834, height: 626 });
    expect(readImageHeader(a!.data).format).toBe("jpeg");

    const b = await prepareImage(rotated, box, "print");
    expect(b).toMatchObject({ format: "jpg", width: 556, height: 834 }); // portrait after EXIF rotation

    const c = await prepareImage(logo, box, "print", { keepAlpha: true });
    expect(c).toMatchObject({ format: "png", width: 600, height: 300 }); // never enlarged
    expect(readImageHeader(c!.data).hasAlpha).toBe(true);

    expect(await prepareImage(new Uint8Array([1, 2, 3]), box, "print")).toBeNull(); // "Image unavailable" placeholder
  });
});

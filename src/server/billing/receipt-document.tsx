import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { formatPaise } from "@/lib/format";
import { registerCatalogueFonts, SANS_STACK, DISPLAY_STACK } from "@/server/pdf/fonts";

import type { ReceiptData } from "./service";

/**
 * Payment receipt PDF. It is deliberately a *payment receipt*, not a GST tax
 * invoice: it states only what Razorpay confirmed and what the shop entered
 * as its business details. Seller details come from billingConfig.receipts
 * and are shown as "not yet configured" until you supply them.
 */

const s = StyleSheet.create({
  page: { padding: 48, fontFamily: SANS_STACK, fontSize: 10, color: "#1f1b16" },
  banner: { backgroundColor: "#fdf1d6", color: "#6b4a00", padding: 8, marginBottom: 16, fontSize: 9, fontWeight: 600 },
  title: { fontFamily: DISPLAY_STACK, fontSize: 26, fontWeight: 600, marginBottom: 4 },
  muted: { color: "#6f665c" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  col: { width: "48%" },
  label: { fontSize: 8, color: "#6f665c", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  table: { marginTop: 28, borderTopWidth: 1, borderColor: "#d9d1c5" },
  tr: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: "#ece6dc" },
  td1: { width: "70%" },
  td2: { width: "30%", textAlign: "right" },
  total: { flexDirection: "row", paddingVertical: 10, fontWeight: 600, fontSize: 12 },
  note: { marginTop: 28, fontSize: 8.5, color: "#6f665c", lineHeight: 1.5 },
});

const dateIst = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso)) + " IST" : "—";

function ReceiptDocument({ r }: { r: ReceiptData }) {
  const seller = r.seller;
  const sellerReady = Boolean(seller.legalName && seller.address);
  const net = r.payment.amountPaise - r.payment.amountRefundedPaise;
  return (
    <Document title={`Receipt ${r.receiptNumber}`} author={seller.legalName || "Seller"} creator="Billing">
      <Page size="A4" style={s.page}>
        {r.mode === "test" ? <Text style={s.banner}>TEST MODE — no real money was charged. This receipt is for testing only.</Text> : null}
        <Text style={s.title}>Payment receipt</Text>
        <Text style={s.muted}>Receipt no. {r.receiptNumber} · Issued {dateIst(r.issuedAt)}</Text>

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>From</Text>
            {sellerReady ? (
              <>
                <Text>{seller.legalName}</Text>
                <Text>{seller.address}</Text>
                {seller.gstin ? <Text>GSTIN: {seller.gstin}</Text> : null}
                {seller.email ? <Text>{seller.email}</Text> : null}
              </>
            ) : (
              <Text style={s.muted}>Seller details not yet configured.</Text>
            )}
          </View>
          <View style={s.col}>
            <Text style={s.label}>Billed to</Text>
            <Text>{r.buyer.name || "—"}</Text>
            {r.buyer.address ? <Text>{r.buyer.address}</Text> : null}
            {r.buyer.email ? <Text>{r.buyer.email}</Text> : null}
            {r.buyer.phone ? <Text>{r.buyer.phone}</Text> : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tr}>
            <Text style={[s.td1, s.label]}>Description</Text>
            <Text style={[s.td2, s.label]}>Amount</Text>
          </View>
          <View style={s.tr}>
            <View style={s.td1}>
              <Text>{r.payment.description}</Text>
              {r.payment.creditsGranted > 0 ? <Text style={s.muted}>{r.payment.creditsGranted} image credits</Text> : null}
            </View>
            <Text style={s.td2}>{formatPaise(r.payment.amountPaise)}</Text>
          </View>
          {r.payment.amountRefundedPaise > 0 ? (
            <View style={s.tr}>
              <Text style={s.td1}>Refunded</Text>
              <Text style={s.td2}>− {formatPaise(r.payment.amountRefundedPaise)}</Text>
            </View>
          ) : null}
          <View style={s.total}>
            <Text style={s.td1}>{r.payment.amountRefundedPaise > 0 ? "Net paid" : "Total paid"}</Text>
            <Text style={s.td2}>{formatPaise(net)}</Text>
          </View>
        </View>

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Paid on</Text>
            <Text>{dateIst(r.payment.capturedAt ?? r.payment.createdAt)}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Payment reference</Text>
            <Text>{r.payment.razorpayPaymentId}</Text>
            {r.payment.method ? <Text style={s.muted}>Method: {r.payment.method}</Text> : null}
          </View>
        </View>

        <Text style={s.note}>
          Processed by Razorpay. {r.pricesIncludeGst ? `Prices include GST where applicable.` : `Prices exclude GST.`} This is a payment
          receipt, not a tax invoice.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(r: ReceiptData): Promise<Buffer> {
  registerCatalogueFonts();
  return renderToBuffer(<ReceiptDocument r={r} />);
}

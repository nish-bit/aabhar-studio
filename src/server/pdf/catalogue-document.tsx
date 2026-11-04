/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> has no alt prop; the PDF carries text labels instead. */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { formatPricePaise, type CatalogueSpec } from "@/lib/catalogue";

import { DISPLAY_STACK, SANS_STACK } from "./fonts";
import { chunk, coverImageBox, FOOTER_HEIGHT, GAP, gridSpec, hasContactDetails, imageBox, itemsPerPage, MARGIN, pageSize } from "./layout";
import type { PdfCatalogueInput, PreparedImage } from "./model";

/** Print palette: neutral, high contrast, gold only for thin rules. */
const C = { ink: "#1c1a17", muted: "#5e5850", faint: "#a39b8f", rule: "#e6dfd3", gold: "#b08a4a", sunken: "#f4efe6" };

// react-pdf accepts font-family arrays (fallback per glyph); its types only say string.
const sans = SANS_STACK as unknown as string;
const display = DISPLAY_STACK as unknown as string;

const s = StyleSheet.create({
  page: { fontFamily: sans, color: C.ink, backgroundColor: "#ffffff", fontSize: 9 },
  footer: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN - 18,
    height: FOOTER_HEIGHT,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    paddingTop: 6,
    fontSize: 7.5,
    color: C.muted,
  },
  imageFrame: { backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  missing: { backgroundColor: C.sunken, borderWidth: 0.75, borderColor: C.rule, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  missingText: { fontSize: 8, color: C.muted },
  name: { fontFamily: display, fontWeight: 600, color: C.ink },
  sku: { fontSize: 7.5, color: C.muted, letterSpacing: 0.4 },
  price: { fontWeight: 600, color: C.ink },
  priceNote: { color: C.muted },
  body: { color: C.ink, lineHeight: 1.4 },
  specLabel: { color: C.muted },
  rule: { height: 0.75, backgroundColor: C.gold, width: 28 },
});

export interface CatalogueAssets {
  items: Map<string, PreparedImage | null>;
  cover: PreparedImage | null;
  logo: PreparedImage | null;
}

/* --------------------------------------------------------------- parts */

function Footer({ label }: { label: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={{ maxLines: 1, maxWidth: "75%" } as never}>{label}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function ProductImage({ image, width, height }: { image: PreparedImage | null; width: number; height: number }) {
  if (!image) {
    return (
      <View style={[s.missing, { width, height }]}>
        <Text style={s.missingText}>Image unavailable</Text>
      </View>
    );
  }
  return (
    <View style={[s.imageFrame, { width, height }]}>
      <Image src={{ data: image.data, format: image.format }} style={{ width, height, objectFit: "contain" }} />
    </View>
  );
}

function Price({ input, pricePaise, size }: { input: PdfCatalogueInput; pricePaise: number | null; size: number }) {
  if (!input.showPrices) return null;
  if (pricePaise !== null) return <Text style={[s.price, { fontSize: size }]}>{formatPricePaise(pricePaise)}</Text>;
  if (input.priceNote) return <Text style={[s.priceNote, { fontSize: size - 1 }]}>{input.priceNote}</Text>;
  return null;
}

function Specs({ specs, max, size }: { specs: CatalogueSpec[]; max?: number; size: number }) {
  if (specs.length === 0) return null;
  const shown = max === undefined ? specs : specs.slice(0, max);
  const hidden = specs.length - shown.length;
  return (
    <View style={{ marginTop: 4 }}>
      {shown.map((spec, i) => (
        <Text key={i} style={{ fontSize: size, lineHeight: 1.35, maxLines: max === undefined ? undefined : 1, textOverflow: "ellipsis" } as never}>
          {spec.label ? <Text style={s.specLabel}>{spec.label}: </Text> : null}
          {spec.value}
        </Text>
      ))}
      {hidden > 0 && <Text style={{ fontSize: size, color: C.faint }}>+{hidden} more</Text>}
    </View>
  );
}

/* --------------------------------------------------------------- pages */

function CoverPage({ input, assets }: { input: PdfCatalogueInput; assets: CatalogueAssets }) {
  const size = pageSize(input.orientation);
  const box = coverImageBox(input.orientation);
  const title = input.coverTitle || input.catalogueName;
  const portrait = input.orientation === "portrait";

  const brand = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {assets.logo && (
        <Image
          src={{ data: assets.logo.data, format: assets.logo.format }}
          style={{ maxWidth: 140, maxHeight: 48, objectFit: "contain" }}
        />
      )}
      {input.business.name ? <Text style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6 }}>{input.business.name}</Text> : null}
    </View>
  );

  const titleBlock = (
    <View>
      <View style={s.rule} />
      <Text style={{ fontFamily: display, fontWeight: 500, fontSize: portrait ? 40 : 36, lineHeight: 1.1, marginTop: 14, maxLines: 3 } as never}>
        {title}
      </Text>
      {input.coverSubtitle ? (
        <Text style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.45, maxLines: 4 } as never}>{input.coverSubtitle}</Text>
      ) : null}
    </View>
  );

  if (portrait) {
    return (
      <Page size="A4" orientation={input.orientation} style={[s.page, { padding: MARGIN }]}>
        {brand}
        <View style={{ marginTop: 28, alignItems: "center" }}>
          {assets.cover ? <ProductImage image={assets.cover} width={box.width} height={box.height} /> : <View style={{ height: box.height }} />}
        </View>
        <View style={{ marginTop: 32 }}>{titleBlock}</View>
      </Page>
    );
  }
  return (
    <Page size="A4" orientation={input.orientation} style={[s.page, { flexDirection: "row" }]}>
      <View style={{ width: size.width - box.width, padding: MARGIN, justifyContent: "space-between" }}>
        {brand}
        {titleBlock}
      </View>
      {assets.cover ? <ProductImage image={assets.cover} width={box.width} height={box.height} /> : <View style={{ width: box.width, backgroundColor: C.sunken }} />}
    </Page>
  );
}

function GridPages({ input, assets, footer }: { input: PdfCatalogueInput; assets: CatalogueAssets; footer: string }) {
  const g = gridSpec(input.orientation);
  const pages = chunk(input.items, itemsPerPage("grid", input.orientation));
  return (
    <>
      {pages.map((pageItems, pageIndex) => (
        <Page key={pageIndex} size="A4" orientation={input.orientation} style={[s.page, { padding: MARGIN, paddingBottom: MARGIN + FOOTER_HEIGHT }]}>
          {chunk(pageItems, g.cols).map((row, rowIndex) => (
            <View key={rowIndex} style={{ flexDirection: "row", gap: GAP, height: g.rowHeight, marginBottom: rowIndex < g.rows - 1 ? GAP : 0 }}>
              {row.map((item) => (
                <View key={item.id} style={{ width: g.cellWidth, height: g.rowHeight, overflow: "hidden" }}>
                  <ProductImage image={assets.items.get(item.id) ?? null} width={g.cellWidth} height={g.imageHeight} />
                  <View style={{ marginTop: 8, gap: 2 }}>
                    {item.name ? (
                      <Text style={[s.name, { fontSize: 12, lineHeight: 1.2, maxLines: g.clamp.name, textOverflow: "ellipsis" } as never]}>{item.name}</Text>
                    ) : null}
                    {item.sku ? <Text style={[s.sku, { maxLines: 1, textOverflow: "ellipsis" } as never]}>{item.sku}</Text> : null}
                    <Price input={input} pricePaise={item.pricePaise} size={9.5} />
                    {item.description ? (
                      <Text style={[s.body, { fontSize: 8, marginTop: 2, maxLines: g.clamp.description, textOverflow: "ellipsis" } as never]}>
                        {item.description}
                      </Text>
                    ) : null}
                    <Specs specs={item.specs} max={g.clamp.specs} size={7.5} />
                  </View>
                </View>
              ))}
            </View>
          ))}
          <Footer label={footer} />
        </Page>
      ))}
    </>
  );
}

function EditorialPages({ input, assets, footer }: { input: PdfCatalogueInput; assets: CatalogueAssets; footer: string }) {
  const size = pageSize(input.orientation);
  const box = imageBox("editorial", input.orientation);
  const portrait = input.orientation === "portrait";

  return (
    <>
      {input.items.map((item) => {
        // An explicit width keeps long text inside the page; flex alone lets it overflow.
        const detailsWidth = portrait ? box.width : size.width - 2 * MARGIN - box.width - 24;
        const details = (
          <View style={{ width: detailsWidth }}>
            {item.name ? <Text style={[s.name, { fontSize: 22, lineHeight: 1.15 }]}>{item.name}</Text> : null}
            {item.sku ? <Text style={[s.sku, { marginTop: 4 }]}>{item.sku}</Text> : null}
            <View style={{ marginTop: 8 }}>
              <Price input={input} pricePaise={item.pricePaise} size={12} />
            </View>
            {(item.name || item.sku) && <View style={[s.rule, { marginTop: 10 }]} />}
            {item.description ? <Text style={[s.body, { fontSize: 10, marginTop: 10, lineHeight: 1.5 }]}>{item.description}</Text> : null}
            <Specs specs={item.specs} size={9} />
          </View>
        );
        return (
          // wrap: a very long description continues onto a following page instead of being cut off.
          <Page key={item.id} size="A4" orientation={input.orientation} style={[s.page, { padding: MARGIN, paddingBottom: MARGIN + FOOTER_HEIGHT }]} wrap>
            {portrait ? (
              <View>
                <ProductImage image={assets.items.get(item.id) ?? null} width={box.width} height={box.height} />
                <View style={{ marginTop: 18 }}>{details}</View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 24 }}>
                <ProductImage image={assets.items.get(item.id) ?? null} width={box.width} height={box.height} />
                {details}
              </View>
            )}
            <Footer label={footer} />
          </Page>
        );
      })}
    </>
  );
}

function ContactPage({ input, assets, footer }: { input: PdfCatalogueInput; assets: CatalogueAssets; footer: string }) {
  const b = input.business;
  const rows: [string, string][] = (
    [
      ["Phone", b.phone],
      ["WhatsApp", b.whatsapp],
      ["Email", b.email],
      ["Website", b.website],
      ["Address", b.address],
    ] as [string, string][]
  ).filter(([, v]) => v.trim() !== "");

  return (
    <Page size="A4" orientation={input.orientation} style={[s.page, { padding: MARGIN, paddingBottom: MARGIN + FOOTER_HEIGHT, justifyContent: "center" }]}>
      <View style={{ maxWidth: 380 }}>
        {assets.logo && (
          <Image src={{ data: assets.logo.data, format: assets.logo.format }} style={{ maxWidth: 160, maxHeight: 60, objectFit: "contain", marginBottom: 20 }} />
        )}
        <View style={s.rule} />
        <Text style={{ fontFamily: display, fontWeight: 500, fontSize: 30, marginTop: 14 }}>Contact</Text>
        {b.name ? <Text style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{b.name}</Text> : null}
        <View style={{ marginTop: 18, gap: 10 }}>
          {rows.map(([label, value]) => (
            <View key={label} style={{ flexDirection: "row" }}>
              <Text style={{ width: 70, fontSize: 9, color: C.muted }}>{label}</Text>
              <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.4 }}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
      <Footer label={footer} />
    </Page>
  );
}

/* ------------------------------------------------------------ document */

export function CatalogueDocument({ input, assets }: { input: PdfCatalogueInput; assets: CatalogueAssets }) {
  const footer = input.business.name ? `${input.business.name} · ${input.catalogueName}` : input.catalogueName;
  const showContact = input.includeContactPage && hasContactDetails(input.business);

  return (
    <Document
      title={input.catalogueName}
      author={input.business.name || undefined}
      subject={input.coverSubtitle || undefined}
      creator="Aabhar Studio"
      producer="Aabhar Studio"
      language="en-IN"
    >
      {input.includeCover && <CoverPage input={input} assets={assets} />}
      {input.items.length === 0 ? (
        <Page size="A4" orientation={input.orientation} style={[s.page, { padding: MARGIN, justifyContent: "center", alignItems: "center" }]}>
          <Text style={{ color: C.muted }}>This catalogue has no products yet.</Text>
          <Footer label={footer} />
        </Page>
      ) : input.layout === "grid" ? (
        <GridPages input={input} assets={assets} footer={footer} />
      ) : (
        <EditorialPages input={input} assets={assets} footer={footer} />
      )}
      {showContact && <ContactPage input={input} assets={assets} footer={footer} />}
    </Document>
  );
}

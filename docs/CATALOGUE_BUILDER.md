# Catalogue builder

Shops turn their approved images into a branded, print-ready A4 catalogue.
Everything printed comes from saved database records: the shop's own business
details, the images they approved in the Studio, and the product text they
typed. The builder never adds prices, materials, weights, gemstone grades,
certifications or any other product claim.

---

## What it does

| Area | Details |
| --- | --- |
| Catalogues | Create, rename, duplicate (with all products), delete to "Recently deleted", restore. Autosaving drafts with a save indicator; a stale tab gets "changed elsewhere — reload" instead of overwriting newer settings. |
| Business details | Business name, logo (PNG/JPG/WebP ≤ 2 MB, re-encoded as PNG with transparency kept), phone, WhatsApp, email, website, address. Blank fields are never printed. |
| Products | Added only from the shop's own **approved** images, in the order selected; duplicates skipped. Fields: name, SKU, description (≤ 2,000 characters), price (optional, in ₹, Indian grouping), up to 12 specifications. A new product starts completely blank. |
| Order | Up/down buttons on every product (keyboard and touch), drag handle on desktop. |
| Layouts | **Grid** — 4 per page (portrait) or 6 (landscape); long text is shortened with "…" and extra specs show "+N more". **Editorial** — one product per page with the full description; text that doesn't fit continues onto the next page. |
| Pages | Optional cover (logo, business name, title, subtitle, first product image), product pages, optional contact page (skipped automatically if no contact details), footer with page numbers. |
| Prices | Off by default. When on, only prices the shop entered are shown; products without a price show the shop's own optional note (e.g. "Price on request") or nothing. |
| Preview | Renders the same PDF with screen-resolution images, shown in the editor. |
| Export | Print PDF stored privately with a 10-minute download link; ZIP of the original approved images named `01-SKU.png`; per-product image download. Each export is recorded. |
| Warnings | Before export: missing images, unnamed products, products without a price (when prices are on), no business name, contact page that will be skipped. |

## PDF specification

- **Library:** `@react-pdf/renderer` 4.9 (pure JavaScript, runs in Node and on Vercel).
- **Page size:** ISO A4 — 595.28 × 841.89 pt portrait, 841.89 × 595.28 pt landscape — on every page. 15 mm safe margins.
- **Fonts, embedded and subset:** Inter (text), Cormorant Garamond (display), Noto Sans Devanagari (fallback, so Hindi product names print). Inter and Cormorant were merged from their Latin and Latin Extended subsets so the ₹ sign is included. Licences in `src/server/pdf/fonts/`.
- **Images:** resampled to the pixel size of the box they're drawn in at **300 DPI** (print) or ~110 DPI (preview), never enlarged; JPEG quality 88 with 4:4:4 chroma so metal edges and stones stay crisp; logos keep transparency as PNG.
- **Missing or corrupt images:** drawn as an "Image unavailable" placeholder; the export still succeeds.
- **Metadata:** title (catalogue name), author (business name), creator.
- **Colour:** RGB. Most digital and local print shops accept it; offset printers may ask for CMYK conversion.
- **Bleed:** none (trim size only). Backgrounds are white, so nothing needs to extend past the edge.

## Verification done

The demo catalogue (`npm run catalogue-demo`) is built through the real service
and SQL on embedded Postgres with the project's migrations: 10 products, a
logo, business details, one product whose image was later deleted, one Hindi
product name and one long description.

| Check | A4 portrait grid | A4 landscape editorial |
| --- | --- | --- |
| Pages | 5 (cover, 4 + 4 + 2 products, contact) | 12 (cover, 10 products, contact) |
| Every page exactly A4 | yes (595.28 × 841.89) | yes (841.89 × 595.28) |
| Fonts embedded and subset | 5 of 5 | 5 of 5 |
| Largest image resolution | 300 ppi (capped) | 300 ppi (capped) |
| File size | 0.97 MB | 1.50 MB |

Visually checked: cover with logo, the grid shortening the long description
while editorial prints it in full, the placeholder for the missing image,
Hindi shaping, the contact page and page numbers.

Automated (`npm test`):

- `tests/pdf/catalogue-pdf.test.ts` parses rendered PDFs with pdf.js and
  checks page count and size, page numbering, that all text stays inside the
  margins, embedded fonts, image downsampling, grid clamping without spilling
  into other cells, a 2,000-character description plus 12 specs continuing
  onto a second page in portrait and landscape with nothing lost, prices
  shown only when supplied and enabled, Hindi text, corrupt images, empty
  catalogues, and that a PDF contains **only** text the shop supplied (plus
  page numbers and the missing-image label).
- `tests/catalogue/service.test.ts` runs the service against the real
  schema: create/rename/reopen, version conflicts, approved-only images from
  the user's own shop, saved fields exactly as typed, validation, reorder and
  remove, duplicate, delete and restore, viewer read-only access, missing
  images, logo validation, exports — and that another shop gets "not found"
  for every catalogue and product operation.

---

## Setup

1. Apply the migration `supabase/migrations/20261020000200_catalogues.sql`
   (`npx supabase db push`, or paste it into the SQL editor). It adds the
   catalogue tables, RLS read policies, a business profile for every shop and
   two private buckets: `brand-assets` and `catalogues`.
2. Set `DATABASE_URL` to Supabase's **transaction pooler** connection string
   (Supabase → Connect → Transaction pooler, port 6543). The catalogue builder
   uses a direct Postgres connection for its transactional writes (reorder,
   duplicate, add products); prepared statements are disabled, as that pooler
   mode requires.
3. The Supabase keys from the previous phase are still needed for sign-in and
   storage.

Without these the catalogue pages show a labelled "not connected" notice.

## Try it

**With real data in the app:** approve a few results in the Studio → Business
(add name, logo, contact details) → Catalogues → New catalogue → Add approved
images → fill in the details you want printed → Preview → Export PDF.

**Without any setup:**

```bash
npm run catalogue-demo
open tmp-output/catalogue-demo/catalogue-a4-portrait-grid.pdf
```

The demo's business details and product text are labelled test data and only
describe what is visible in each photo.

---

## Known limits

- **Source resolution:** Studio results are 1024–1536 px. They reach 300 ppi in
  grid cells, but a full-width editorial image prints at ~170–240 ppi. For
  large editorial prints, generate at a higher output size (the gpt-image-2
  family accepts custom sizes up to 3840 × 2160).
- Grid layouts shorten long text by design; the editor says so, and editorial
  prints everything.
- Exports run within the request (up to 180 s) and the images ZIP is built in
  memory; both are fine for the 100-product limit. Larger catalogues should
  move to the background job queue.
- "Recently deleted" catalogues are kept until restored; automatic purging
  after 30 days isn't implemented yet.
- Preview uses the browser's PDF viewer, which on some phones shows only the
  first page; "Open in new tab" shows the whole file.

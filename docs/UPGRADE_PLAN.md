# Upgrade plan — Phase 1: reference audit and codebase inspection

**Date:** 20 October 2026

## 1. Reference audit: gehnaphoto.com

**How it was inspected.** I loaded the live homepage in a real browser pane
and read its rendered text, structure, images and network requests. I also
checked it at mobile width (375 px) and clicked the "Start creating" demo.
Visual screenshots couldn't be captured because the desktop app window was
hidden, so the visual notes below come from the DOM and computed styles,
not from viewing the page. I didn't sign in or upload anything, so their
signed-in studio, onboarding and checkout were **not** inspected.

**What I observed:**
- **Page:** a single long page with anchor navigation (Home, Process,
  Gallery, Pricing, Sign in). It uses the same type pairing as your site:
  a serif display face with an Inter UI face.
- **Hero:** one headline and one primary call to action. The free-trial
  line sits right under the button.
- **"Free first photo" demo:** the visitor picks one of six sample pieces
  and sees a before/after slider, then a prompt to sign in with Google and
  make 2 of their own. **It doesn't generate anything:** no generation
  request is made, and it shows pre-made input/output images.
- **How it works:** three steps.
- **Gallery:** before/after sliders by category, captioned as being from
  "jewellers who tried it this week".
- **Style taxonomy:** read from image labels — studio, close-up, macro,
  flat-lay, shop display, Indian bridal and modern wear (on a model).
- **Categories:** ring, earring, necklace and sets, bracelet, bangle,
  pendant, payal and maang tikka.
- **Pricing:** three one-time credit packs with crossed-out "original"
  prices and a per-image price. They advertise 4K exports, commercial
  rights and WhatsApp priority support, plus a custom-order contact via
  WhatsApp, a "100% refund" line, and 2 free images after phone
  verification.
- **FAQ:** grouped into using the tool, credits and billing, and your
  photos.
- **Support and footer:** a floating WhatsApp button; footer links to
  privacy, terms and contact (email). PostHog analytics is loaded.
- **Mobile:** a hamburger menu and no horizontal overflow at 375 px.

### What works well
1. A **very short path to the first "wow"**: a sample piece leads straight
   to a before/after, one tap from the hero.
2. **Interactive before/after sliders**, organised by jewellery category.
3. **A concrete style vocabulary** that jewellers recognise (macro,
   flat-lay, shop display, bridal, worn on a model).
4. **Indian-specific categories** (payal, maang tikka), sets, and model
   shots.
5. **Price per image** shown on each pack, which makes packs easy to
   compare.
6. **WhatsApp** as the main support channel, which suits Indian shop
   owners.
7. A small, focused FAQ grouped by topic.

### What your site should improve or do differently
1. **Keep it honest where the reference isn't.** Their free demo is
   labelled as getting "a catalogue photo in 5 seconds", but it shows
   pre-made images. Your demo should be labelled as examples and should
   lead to a real first generation.
2. **No unverifiable claims.** Avoid customer counts, "this week"
   captions, crossed-out anchor prices and a blanket "100% refund" unless
   they're true and documented. Your rules already require this.
3. **Your homepage currently over-promises.** It describes features that
   aren't built yet (§3). Fixing this is the first change, made in this
   phase.
4. **A faster first result, honestly.** Show labelled example
   before/afters at the top, then send people to sign-up and a real trial
   generation. Consider Google sign-in alongside the email code.
5. **Fidelity is your differentiator.** You already have a side-by-side
   review, approve/discard, and a fidelity warning on every result. Make
   it visible on the homepage, and add "report an inaccurate result".
6. **Don't copy their headline.** The master prompt's suggested headline
   ("Turn One Jewellery Photo Into a Premium Catalogue") is, word for
   word, the reference site's hero. Your own wording should be used
   instead.

### New features that would help Indian jewellers
1. **Jewellery category input** (ring, jhumka, mangalsutra, payal, bridal
   set…) passed to the prompt, so framing and scale suit the piece.
2. **Output aspect ratios** for real channels: 1:1 marketplace, 4:5
   Instagram, 9:16 status/stories, plus print-size options.
3. **A batch studio:** upload a folder, apply one style to all, and
   approve in bulk. Wholesalers need this most.
4. **A library:** every image ever made, with filters, re-download,
   favourites and "add to catalogue".
5. **WhatsApp-ready outputs:** share sheet on mobile, and a smaller
   "WhatsApp" PDF size for catalogues.
6. **Catalogue extras:** price-list layout, CSV import of SKU/price/specs
   typed by the user, Hindi and regional-language text (fonts already
   embedded), and retail/wholesale variants.
7. **"Report inaccurate result"** that refunds the credits after review and
   feeds a quality dashboard in admin.
8. **Festive and bridal scene styles**, plus model-wearing images, but
   only once a model with reliable product preservation is tested.
   Worn-on-model edits carry the highest fidelity risk.

## 2. Codebase inspection

| Area | Current state |
|---|---|
| Stack | Next.js 16 App Router with TypeScript, Tailwind v4, shadcn/Radix and Motion. Backend logic in Next route handlers (`src/app/api/**`) and services (`src/server/**`). Supabase (auth with email code, Postgres with RLS, private storage). OpenAI Images edits (reference-image input). Razorpay (test mode). Vercel. |
| FastAPI | **Not used, and migration isn't recommended.** Everything runs in Next route handlers with tested services. Moving to FastAPI would mean a second deployment, rewriting about 50 API routes and 196 tests, and duplicating auth/session handling, for no functional gain. Revisit only if you need Python-only image tooling; a small separate worker would suit that better. |
| Routes | Marketing: `/`, `/pricing`, `/login`, `/legal/*` (drafts), `/contact` (draft). App: `/app/studio`, `/app/catalogues`, `/app/catalogues/[id]`, `/app/billing`, `/app/settings/business`. Admin: `/admin/*`. |
| Working and tested | Upload validation; single-photo generation with retries and refunds; compare/approve/download; catalogue builder with PDF/ZIP; credits; Razorpay plans and packs; webhooks; admin; retention; rate limits; security headers (196 automated tests, plus browser QA in the last phase) |
| Missing vs this prompt | Dashboard home; image library/history beyond the current session; download history; category selection; aspect ratio and resolution options; "report inaccurate"; batch upload; Google sign-in; WhatsApp support link; sitemap/robots/Open Graph; examples gallery with real before/afters |
| Content problems | Homepage claims unbuilt features (fixed now, see §3); demo before/after pairs are simulated, which is labelled correctly but still needs real customer pairs |
| Design system | Already close to the requested palette: charcoal `#1c1a17` (requested `#171614`), ivory canvas `#faf7f2` (requested `#F5F0E7`), gold `#c9a464`/`#b08a4a` (requested `#C5A46D`), Cormorant Garamond with Inter. Recommend nudging the tokens to the requested values rather than redesigning. |
| Last QA | 44 page/width combinations clean; no console errors; no overflow |

## 3. Homepage copy that didn't match the product (fixed in this phase)

| Claim | Reality | Change |
|---|---|---|
| "Drop in … a whole folder", "batch", "bulk approve", "batch export" | One photo at a time | Reworded to the real flow; batch is listed as a roadmap item |
| "We flag blurry, dark or duplicate shots" | Only too-small/too-large and type checks | Says what's actually checked |
| Six styles (Classic White, Champagne Silk, Showroom, Velvet Bust, Presentation Box…) | The real presets are White Studio, Warm Ivory, Black Luxury, Velvet, Marble and Editorial | Showcase is now generated from the real preset list |
| "Results that may have changed detail are flagged" | Every result shows a generic check-every-detail warning; nothing is detected | Describes the side-by-side check |
| "Price-list layouts", "from a spreadsheet", "private link", "WhatsApp-sized PDFs" | Grid and editorial layouts; manual entry; PDF/ZIP download | Matches the builder |
| "4:5 and 9:16 crops", "1:1 and 3:4", "SKU from file names", "brand kit" | Output size follows the photo's shape | Removed |
| "Share to WhatsApp" | Download only | Removed |
| "Start with 10 free images" | Trial size is configurable by admin | Taken from the live trial setting |
| Sample catalogue with invented weights and purities | Demo data, labelled in code | Weight/purity removed; shown as "sample" |

## 4. Implementation plan

| Phase | Work | Main files | Risk |
|---|---|---|---|
| 2 | Proposed sitemap, design tokens nudge, homepage section order (below) for your review | `docs/UPGRADE_PLAN.md` | none |
| 3 | Homepage: hero with real before/after, examples gallery (needs your real pairs), categories, styles, fidelity section, pricing teaser, FAQ, footer with WhatsApp; token update | `src/app/(marketing)/*`, `src/components/marketing/*`, `globals.css` | low |
| 4 | `/app` dashboard home (credits, generate, recent, catalogues, plan); `/app/library` (all results, filters, pagination); download log | new `src/app/(app)/app/page.tsx`, `library/`, services and SQL | medium |
| 5 | Category select and aspect ratio in the studio (prompt and size); "report inaccurate" with refund-after-review; prompt tests | `presets.ts`, `prompts.ts`, studio components, migration | medium |
| 6 | Price-list layout, CSV import of user-typed fields, catalogue sharing; pricing page shows per-image price | catalogue and PDF modules | medium |
| 7 | Sitemap, robots, Open Graph image, canonical URLs, JSON-LD (Organization only), Google sign-in, keyboard/contrast pass | `app/sitemap.ts`, `robots.ts`, `layout.tsx` | low |
| 8 | Full test run, browser QA, deployment notes | — | — |

### Proposed sitemap (Phase 2)
`/` · `/examples` (real before/after gallery) · `/pricing` · `/login` ·
`/legal/privacy` · `/legal/terms` · `/legal/refunds` · `/contact` · `/app`
(dashboard) · `/app/studio` · `/app/library` · `/app/catalogues` ·
`/app/billing` · `/app/settings/business` · `/admin/*`

### Needs from you
- **Real before/after pairs** (your own pieces, or customers' with
  consent). The homepage pairs are still simulated.
- **Your WhatsApp support number**, if you want a WhatsApp button.
- **Approval to add Google sign-in** (a Google OAuth client is needed) and
  phone verification for free credits (needs an SMS provider; costs
  money).
- **The model-wearing style:** keep it off until a real test shows
  acceptable fidelity.

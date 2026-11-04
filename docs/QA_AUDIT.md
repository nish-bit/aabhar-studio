# Pre-launch QA and security audit

**Date:** 20 October 2026 · **Commit:** see git log (`Pre-launch audit fixes…`)

## How to read this

Every result below is one of:
- **Verified** — a test or check actually ran in this audit, with the
  numbers shown.
- **Fixed** — a confirmed problem that was fixed and is now covered by a
  test.
- **Open** — a confirmed problem that isn't fixed. Most need your input or
  accounts.
- **Not tested** — it couldn't run here. These are assumptions until you
  run them.

### Where it ran

A cloud container with:
- Node 22
- **PostgreSQL 16** (a real server, used for the concurrency and access
  tests)
- PGlite (embedded Postgres) for the main suite
- headless Chromium against a **production build** (`next start`)

There were **no** Supabase project, OpenAI key, Razorpay keys, GitHub
repository or Vercel account available. Anything needing them is marked
*Not tested*. Nothing was deployed.

### Automated suite: 196 tests, all passing (17 files)

| Suite | Tests | What it proves |
|---|---|---|
| `tests/pg/rls-sweep` (real PG) | 7 | RLS on every table; only `app.is_shop_member` callable by customers; no anonymous reads; no cross-shop reads in any table; no client writes anywhere; storage objects private per shop |
| `tests/pg/concurrency` (real PG) | 7 | 20 parallel generations with 3 credits → exactly 3 succeed; same idempotency key ×15 → one job and one charge; refund once under 12 parallel failures; spending during the expiry sweep stays consistent; 16 simultaneous webhook/verify calls → one grant; double-click purchase → one order; parallel admin grants and retries apply once |
| `tests/security/uploads` | 8 | SVG/HTML/PDF/GIF/TIFF/HEIC/ELF rejected by bytes; fake JPEG and truncated files rejected; 900-megapixel decompression bomb refused in under 2 s; polyglot payload and EXIF stripped; path traversal impossible; cross-shop upload completion → 404 |
| `tests/security/redirects` | 14 | Post-sign-in redirect accepts same-site paths only |
| `tests/privacy` | 6 | Retention deletes the right files and rows and keeps the rest; webhook PII redacted; account-data deletion (dry run, apply, refusals); rate limiter |
| `tests/admin/*` | 27 | Every admin route as anonymous (401), customer (404), support (read 200, write 403) and admin; CSRF; no secrets or payloads in responses; audit trail; customer CSRF |
| `tests/billing/*` | 42 | Signature checks, idempotency, amount checks, subscription lifecycle, refunds, receipts, credit-lot SQL, client access denied |
| `tests/integration`, `tests/unit`, `tests/catalogue`, `tests/pdf`, `tests/db` | 92 | Generation flow with the real OpenAI adapter against a mocked HTTP endpoint (success, retries, timeouts, refunds), catalogue editing, PDF output (parsed and laid out), migration checks |

Also verified by hand in this audit:

| Check | Result |
|---|---|
| Migrations on real PostgreSQL 16, one transaction per file (as `supabase db push` runs them) | All 6 apply cleanly. `scripts/verify-database.sql` passes, and fails correctly on a table without RLS |
| Secrets in build output: built with unique sentinel values in every secret variable, then searched `.next/` and the build log | **0** occurrences of any server secret in browser bundles, server files, HTML or logs. Only the two intended `NEXT_PUBLIC_` values reach the browser |
| Secrets in git history | None (only deliberate fake test keys) |
| Logging review | Logs carry ids, statuses and error categories. Provider error text, prompts, emails and keys are never logged |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Production HTTP headers | CSP, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` present; `X-Powered-By` removed |
| Unauthenticated API probes | All customer and admin APIs return 401; crons return 401 without the secret; webhook without keys returns 503 |
| Browser QA (production build): 12 pages × 4 widths (1280/768/375/320) | All 44 non-404 combinations clean: no console errors, failed requests, broken images or horizontal overflow, and one `h1` per page. The 404 page logs only its own expected 404 |
| Mobile navigation (375 px) | Skip link is the first tab stop; the menu opens as a dialog, closes on Escape with focus returned, and closes on navigation; no animations under reduced motion |
| Admin dashboard (previous phase, real seeded DB) | All pages at desktop and mobile; promo grant end to end in the browser |

---

## Confirmed issues: fixed in this audit

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High** | **Open redirect after sign-in.** `?next=/\evil.com` passed the check, and browsers resolve it to `https://evil.com`. Confirmed by URL resolution | `safeNextPath()` resolves like a browser and rejects backslashes, control characters and other origins. 14 tests |
| 2 | **High** | **No rate limits on expensive endpoints.** PDF preview/export (renders up to 100 products at 300 DPI, up to 180 s), checkout creation (creates Razorpay orders), verify, receipts and logo uploads | Atomic Postgres rate limiter (`consume_rate_limit`) on all eight endpoints, per user per hour |
| 3 | **High** | **No security headers.** No CSP, clickjacking protection or HSTS | Full set added in `next.config.ts`, and verified on the production build |
| 4 | **High (privacy)** | **Abandoned uploads kept the raw file forever,** with its original metadata (GPS/camera), because cleanup only ran on completion | Daily retention job deletes it after 24 h |
| 5 | **High (privacy)** | **No retention at all:** discarded results, exports, previews and deleted catalogues were kept forever; Razorpay webhook payloads (customer email and phone) were kept forever | `runRetention()` and the daily cron; payloads redacted after 30 days |
| 6 | **High (privacy)** | **No way to delete a customer's data** | `npm run account:delete` (dry run, then `--apply`; audited; keeps financial records) |
| 7 | Medium | Customer APIs accepted writes **without** an `Origin` header (admin APIs already required it) | Same-origin `Origin` now required on all customer writes and sign-out. Test added |
| 8 | Medium | **12 broken links** in the header and footer, including Privacy, Terms, Refunds and Contact. Next.js prefetching them caused every console error seen in QA | Marketing links now point to existing sections. Legal and contact pages added as **drafts** (see Open #1) |
| 9 | Medium | No error boundary or not-found page outside `/admin`, so customers saw the framework's default error screens | `global-error.tsx`, app `error.tsx` and a branded `not-found.tsx` |
| 10 | Medium | No error monitoring hook and no health check | `instrumentation.ts` `onRequestError` logs structured JSON; `GET /api/health` |
| 11 | Low | Studio's setup notice overflowed by 16 px at 320 px wide | Long code tokens now wrap |
| 12 | Low | Catalogues page had no `h1` in its not-connected state | Added |
| 13 | Low | Large preview files couldn't be cleaned up (they weren't tracked) | Recorded as `kind = 'preview'` and expired after 24 h |
| 14 | Low | "Try free — 10 images" was hard-coded although admins can change the trial | Changed to "Try it free" |

## Confirmed issues: open (not fixed)

| # | Severity | Issue | What's needed |
|---|---|---|---|
| 1 | **Launch blocker** | Privacy, Terms, Refunds and Contact pages are **drafts** with placeholders (legal name, address, emails, grievance officer, refund policy, governing law). Razorpay's live activation reviews these pages | You supply the details; a lawyer reviews them |
| 2 | **Launch blocker** | Supabase's default email delivers only to team addresses, 2 per hour, so customers can't sign up | Configure custom SMTP (`docs/DEPLOYMENT.md` §2) |
| 3 | **Launch blocker** | `vercel.json` crons run every 10 minutes and hourly; **Vercel Hobby rejects the deployment** | Vercel Pro |
| 4 | High | Pricing, GST treatment and seller details on receipts are unapproved (from the billing phase) | Your approval (`docs/BILLING.md` §1) |
| 5 | Medium | The CSP allows `*.razorpay.com`; Razorpay doesn't publish an exact list | Confirm Checkout works in the sandbox run |
| 6 | Medium | Supabase session cookies are readable by page JavaScript (the browser client needs this), so an XSS bug would expose sessions | Mitigated by the CSP, no `dangerouslySetInnerHTML`, and React escaping. Keep the CSP; consider admin MFA |
| 7 | Medium | Browser-side errors aren't reported anywhere | Add Sentry's browser SDK, or similar |
| 8 | Low | No self-service data export or account deletion (requests are handled by email and script) | Post-launch |
| 9 | Low | Logos are stored as uploaded (validated, not re-encoded), so they may keep EXIF | Re-encode like product photos (post-launch) |
| 10 | Low | Two simultaneous "create catalogue" requests can exceed the plan's catalogue limit by one | Accept, or add a row lock |

## Not tested (assumptions until you run them)

| Area | Why it couldn't run | How to test |
|---|---|---|
| Registration, login and logout with real email codes | No Supabase project or SMTP | Smoke test step 2 (`docs/DEPLOYMENT.md` §8) in staging. The login UI renders, and the code paths and redirect safety are tested |
| Password recovery | **Not applicable**: sign-in is passwordless (email code). There's no password to recover; "lost access" means the email account | — |
| Supabase Auth rate limits, OTP expiry and email template | Configuration lives in the Supabase dashboard | Deployment §2 |
| Real AI generation success and failure against OpenAI | No API key. The adapter is tested against a mocked HTTP endpoint for success, 4xx/5xx, timeouts, rate limits and invalid output | One real staging generation, plus one with an invalid key (expect `auth`, no credit loss) |
| Original-vs-edited comparison slider and downloads in the browser with real images | Needs real storage and signed URLs; the services and URLs are tested | Smoke test step 3 |
| Large PDF previews redirecting to Supabase Storage inside the preview frame | Needs real storage; depends on Supabase allowing framing | Preview a 100-product catalogue in staging |
| Supabase Storage policies on the real platform | Tested against a faithful stub of `storage.objects` with the real policies; not on Supabase itself | `scripts/verify-database.sql` checks the buckets; a cross-account signed-URL attempt in staging |
| Razorpay Checkout, webhooks and subscription lifecycle against the real sandbox | No keys. Lifecycle tested with a fake gateway using real HMAC signatures and real SQL | `docs/BILLING.md` §4 checklist |
| GitHub CI, Vercel deployment, domain, HTTPS, cron delivery | No accounts | Deployment §1–§3; the CI workflow is included but hasn't run on GitHub |
| Load or performance under many users | Out of scope here | k6 against staging, per Supabase's production checklist |
| Screen-reader walkthrough | Only automated checks were run (landmarks, `h1`, alt text, focus) | Manual pass with NVDA or VoiceOver |

---

## Ordered release checklist

Each step depends on the ones before it.

1. **Approve business decisions:** prices, GST treatment, trial size,
   plan limits and refund policy (`docs/BILLING.md` §1).
2. **Complete the legal pages:** fill every highlighted placeholder in
   `/legal/privacy`, `/legal/terms`, `/legal/refunds` and `/contact`; have
   them reviewed; remove the draft banner (`legal-page.tsx`). Set
   `receipts.seller` in `src/config/billing.ts`.
3. **GitHub:** push to a private repository, protect `main` behind CI,
   and confirm CI passes on GitHub.
4. **Supabase staging project:**
   - run `supabase db push`, then `scripts/verify-database.sql` (must print
     PASS)
   - configure custom SMTP, the code email template, OTP expiry, Site URL,
     redirect URLs and rate limits
5. **Vercel Pro project:** connect the repository and set Preview
   environment variables (staging Supabase, OpenAI, Razorpay **test**,
   `CRON_SECRET`, `BILLING_LIVE_APPROVED=false`). Set the region to match
   Supabase. Protect previews.
6. **Staging smoke test** (`docs/DEPLOYMENT.md` §8), including one real AI
   generation that you review for fidelity.
7. **Payments sandbox:**
   - `npm run billing:sync -- --apply` with test keys
   - the test webhook
   - the full lifecycle checklist (`docs/BILLING.md` §4)
   - confirm Checkout works under the CSP
8. **Admin:** grant yourself `admin` (`npm run admin:role`), enable MFA,
   and check `/admin` as admin and as a customer.
9. **Monitoring:** set up a log drain or Sentry, alerts on the events in
   `docs/DEPLOYMENT.md` §7, and an uptime check on `/api/health`.
10. **Supabase production project:**
    - migrations and the verify script
    - point-in-time recovery, SSL enforcement, auth settings as in staging
    - MFA on your Supabase account
11. **Production environment variables and domain:**
    - Production environment variables (production Supabase, OpenAI with a
      usage cap, Razorpay **test** keys first)
    - add the domain and DNS; confirm HTTPS
    - update the Supabase Site URL
12. **Production smoke test** with Razorpay still in test mode.
13. **Go live on payments** (only after your approval):
    - Razorpay KYC and live Subscriptions enabled
    - live keys and a live webhook
    - `BILLING_LIVE_APPROVED=true`
    - `billing:sync -- --apply` (live)
    - one real small purchase, then refund it
14. **Remove `noindex`** in `src/app/layout.tsx` when you want search
    engines to index the site, and replace the demo images and labels as
    noted in the README.
15. **First week after launch:** watch `/admin/errors`, the webhook
    failures, provider cost, and the `request.error` logs daily. Confirm
    the three crons run (Vercel → Crons).

# Deployment runbook

Target: **GitHub → Vercel** (Next.js 16, Node.js runtime) with **Supabase**
(auth, Postgres, storage), **OpenAI** (image edits) and **Razorpay**
(payments). **Cloudflare** manages the domain and DNS only (section 3a).

Follow the sections in order. Steps marked **(you)** need your accounts and
can't be done from the codebase.

---

## 0. Accounts and plans

| Service | Plan needed | Why |
|---|---|---|
| Vercel | **Pro** | `vercel.json` schedules the job watchdog every 10 minutes and billing reconciliation hourly. Hobby accepts only once-a-day crons and fails the deployment otherwise. Functions run up to 300 s (`maxDuration`), within every plan's limit. |
| Supabase | Pro recommended | Free projects pause after a week of inactivity. Pro allows point-in-time recovery. |
| OpenAI | API account with image-model access | See `docs/IMAGE_GENERATION_SETUP.md` (organisation verification may be required for GPT Image models). |
| Razorpay | Test mode first; live needs KYC and Subscriptions enabled | See `docs/BILLING.md`. |
| Google Cloud | Free | OAuth client for "Continue with Google" (`docs/AUTH_AND_PURCHASE.md`). |

Use separate **staging** and **production** Supabase projects and Razorpay
test/live keys. Never point a preview deployment at production data.

## 1. GitHub (you)

1. Create a private repository and push this code. `.env*` files are
   git-ignored; only `.env.example` is committed.
2. Protect `main`: require the **CI** workflow (`.github/workflows/ci.yml`)
   to pass. CI runs:
   - type checking, lint and `npm audit` (production dependencies)
   - all tests, including the real-PostgreSQL concurrency and RLS suites
     against a disposable Postgres service
   - a production build with no secrets
   - every migration, one transaction per file, plus
     `scripts/verify-database.sql`
3. Enable secret scanning and Dependabot alerts.

## 2. Supabase (you)

**Database**

```bash
supabase link --project-ref <ref>
supabase db push                       # applies supabase/migrations in order
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-database.sql   # must print PASS
```

**Auth → Sign-in providers → Google** — customers sign in with Google
only. Follow `docs/AUTH_AND_PURCHASE.md` §Setup: create the Google OAuth
client, paste its Client ID and Secret here, and turn **Email** sign-in
off.

**Auth → URL configuration**
- Site URL: `https://<your-domain>`.
- Redirect URLs: `https://<your-domain>/auth/callback`, plus
  `http://localhost:3000/auth/callback` on the staging project only.

**Auth → SMTP** — not needed for sign-in any more (Google handles it).
Configure it anyway if you want Supabase's security emails to come from
your domain.

**Auth → Rate limits** — review the defaults. Consider CAPTCHA (Auth →
Bot protection) if sign-up abuse appears.

**Auth → MFA** — enable TOTP, and require it for anyone holding an admin
role.

**Database → Settings**
- Enforce SSL.
- Add Network Restrictions if you use a static egress.

**Database → Backups** — enable point-in-time recovery for production.

**Storage** — the migrations create four **private** buckets: `originals`,
`generated`, `brand-assets` and `catalogues`. Confirm none is public (the
verify script checks this).

**Region** — choose the region closest to your customers (e.g. Mumbai,
`ap-south-1`). Set the same region for Vercel functions, for example
Mumbai `bom1`, so database round trips stay short.

## 3. Vercel (you)

1. Import the GitHub repository. The framework preset is Next.js and the
   build command is `npm run build`.
2. **Settings → Environment Variables:** set each value from `.env.example`
   separately for **Preview** (staging Supabase, Razorpay test) and
   **Production**.
   - `DATABASE_URL` must be the transaction pooler URL (port 6543).
   - Set `DATABASE_POOL_MAX` to 3–5.
   - `DATABASE_SSL_CA`: paste the **contents** of Supabase's
     `prod-ca-2021.crt` (Project Settings → Database → SSL Configuration).
     Vercel keeps the line breaks. With it, the database certificate and
     host name are verified; without it, the logs show
     `database.tls_unverified`. Check the downloaded file's SHA-256
     fingerprint starts `80:70:25:AD` (`openssl x509 -in prod-ca-2021.crt
     -noout -fingerprint -sha256`).
   - `BILLING_LIVE_APPROVED=false` until you approve live billing.
   - `CRON_SECRET`: `openssl rand -hex 32`.
3. **Functions:** `vercel.json` pins functions to `arn1` (Stockholm), next
   to the Supabase project in `eu-north-1`. Every API request makes several
   database round trips, so keep them in the same region; change both
   together if the database ever moves. Keep Fluid compute on. Long routes
   set `maxDuration` themselves (generation and admin retry 300 s, catalogue
   export 180 s, preview 120 s, upload check 60 s, retention 300 s), all
   within Vercel's limits with Fluid compute.
4. **Domains:** see section 3a. `www.aabharstudio.com` is the canonical
   host (canonical tags, sitemap, Supabase and Razorpay URLs), so the apex
   redirects to `www`, not the reverse.
   - The app already sends HSTS (2 years, subdomains). Submit the domain
     to the HSTS preload list only once every subdomain serves HTTPS.
5. **Deployment protection:** protect preview deployments (Vercel
   Authentication) so staging isn't public.
6. **Crons** are read from `vercel.json`. All three call the app with
   `Authorization: Bearer $CRON_SECRET`. The every-10-minutes watchdog needs
   the **Pro** plan: Hobby only allows daily crons, and the deployment fails
   otherwise.

   | Route | Schedule | Purpose |
   |---|---|---|
   | `/api/cron/expire-jobs` | every 10 minutes | Fails and refunds stuck jobs |
   | `/api/cron/billing` | hourly | Expires credits; reconciles unconfirmed pack payments |
   | `/api/cron/retention` | daily, 02:53 IST | Data retention (`docs/PRIVACY.md`) |

## 3a. Domain on Cloudflare DNS, site on Vercel (you)

Cloudflare stays the DNS provider; Vercel serves the site and its HTTPS
certificates. Records must be **DNS only** (grey cloud). Proxying (orange
cloud) puts Cloudflare's TLS, cache and managed robots.txt in front of
Vercel, which Vercel doesn't recommend and which breaks its certificate
renewal.

1. **Remove the Worker from the domain first.** Cloudflare → Workers &
   Pages → `aabhar-studio` → Settings → Domains & Routes: remove the
   `www.aabharstudio.com` custom domain (and any route). A Worker custom
   domain owns that DNS name until it's removed. The Worker can then be
   deleted, or kept on its `workers.dev` URL.
2. **Vercel → Project → Settings → Domains:** add `www.aabharstudio.com`
   and `aabharstudio.com`. Set `aabharstudio.com` to **redirect to
   `www.aabharstudio.com` (308)**.
3. **Cloudflare → DNS → Records** (use the exact values Vercel shows on its
   Domains page; these are the usual ones):

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | CNAME | `www` | the `…vercel-dns…com` value Vercel shows | DNS only |
   | A | `@` | `76.76.21.21` (or the value Vercel shows) | DNS only |

   Delete any older `A`/`AAAA`/`CNAME` records for `@` and `www`. Keep the
   `TXT` record for Google Search Console and any email (`MX`) records.
4. Wait until Vercel shows both domains as **Valid Configuration** with a
   certificate issued.
5. **HTTP → HTTPS:** Vercel redirects every `http://` request to `https://`
   automatically (308), and the app sends HSTS. Nothing to configure. With
   DNS-only records, Cloudflare's "Always Use HTTPS" setting no longer
   applies.
6. **Robots policy:** Cloudflare's managed robots.txt (which blocked AI
   training crawlers) only works when proxied. The same rules now live in
   `src/app/robots.ts`. Turn off AI Crawl Control's managed robots.txt in
   Cloudflare so the setting doesn't mislead later.

## 4. Image provider (you)

Set `OPENAI_API_KEY` (production) and optionally `OPENAI_IMAGE_MODEL`.
Generate one real image in staging, following
`docs/IMAGE_GENERATION_SETUP.md`, and approve the result before launch.
Set an OpenAI usage limit and billing alert.

## 5. Payments sandbox (you)

Follow `docs/BILLING.md` §3–§4:
- test keys and the test webhook to `https://<staging>/api/webhooks/razorpay`
- `npm run billing:sync -- --apply`
- then the full sandbox lifecycle checklist

Also confirm that Razorpay Checkout opens and completes under the site's
Content-Security-Policy. The policy allows `*.razorpay.com`; Razorpay
doesn't publish an exact list.

## 6. Admin access

```bash
npm run admin:role -- grant you@yourdomain.com admin "Founder"
```

The person must have signed in once. Use an admin account with MFA.

## 7. Monitoring and operations

- **Errors:** every uncaught server error is logged as one JSON line,
  `event: "request.error"`, with the route, digest and release. Only the
  path is logged, never query strings, headers or bodies. On Vercel:
  - add a **Log Drain** to your error tool (Sentry, Better Stack,
    Datadog…), or
  - add Sentry's Next.js SDK, with its CSP endpoint added.

  Alert on `request.error`, `billing.webhook_failed`,
  `billing.webhook_bad_signature` (in bursts), `generation.provider_error`
  with category `auth` or `quota_exceeded`, and
  `user.auth_ban_failed`.
- **Uptime:** monitor `GET /api/health`, which returns 503 when the
  database is unreachable. It reports booleans only.
- **Business and operations metrics:** `/admin` shows users, generations,
  success rate, provider cost, failures by error code, stuck jobs, webhook
  problems, revenue (test and live shown separately) and MRR.
- **Browser errors** aren't reported anywhere yet. Add Sentry's browser
  SDK if you want them.

## 8. Smoke test after each production deploy

1. `GET /api/health` returns 200.
2. Sign up with a new Google account: you land in the studio and the trial
   credits appear.
3. Upload a photo, generate one image, and compare and download it.
4. Build a catalogue with that image and export the PDF.
5. Check `/admin` loads for your admin account and 404s for a customer
   account.
6. Payments (test mode on staging): buy a pack, then check the receipt
   and the webhook event in `/admin/billing?tab=webhooks`.

---

## 9. Cloudflare Workers (OpenNext) — not the production target

**Production is on Vercel (sections 3 and 3a).** This section and the
blockers below are kept for reference, in case the app is ever ported to
Workers. `npm run deploy` / `wrangler.jsonc` deploy to Workers and should not
be used for production.

Workers runs the app with `npm run deploy` and `wrangler.jsonc`.
Workers can't connect to Supabase Postgres directly with a verified
certificate: Supabase's certificate is signed by Supabase's own root CA, and
outbound Worker sockets only trust public CAs. (The old `ssl: "require"`
setting turned verification off, which Workers reject with
`ERR_OPTION_NOT_IMPLEMENTED: options.rejectUnauthorized`.) So on Workers the
app reads Postgres only through a **Hyperdrive** binding named `HYPERDRIVE`.
Hyperdrive verifies Supabase's certificate and pools connections. Without
it, database features answer 503 (`database.not_configured` in the logs)
rather than hanging. The prerendered pages, including the pricing page,
don't need it.

1. Download Supabase's CA certificate: Supabase → Project Settings →
   Database → SSL Configuration → **Download certificate**
   (`prod-ca-2021.crt`).
2. Upload it to Cloudflare:
   ```bash
   npx wrangler cert upload certificate-authority --ca-cert prod-ca-2021.crt --name supabase-root-2021
   ```
   Note the certificate ID it prints.
3. Create the Hyperdrive config. Use the **session pooler** (port 5432) or
   the direct connection string, not the transaction pooler (6543), because
   Hyperdrive pools connections itself:
   ```bash
   npx wrangler hyperdrive create aabhar-db \
     --connection-string="postgresql://postgres.<ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres" \
     --ca-certificate-id=<certificate id> --sslmode=verify-full
   ```
4. Add the binding to `wrangler.jsonc`, with the ID that step 3 prints:
   ```jsonc
   "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive id>" }]
   ```
5. `npm run deploy`, then check `https://www.aabharstudio.com/api/health`
   shows `"database": true`.

**Secrets.** OpenNext copies the `.env*` files present at build time into the
Worker bundle (`.open-next/cloudflare/next-env.mjs`), so today the server
secrets come from the build machine's `.env.local`. They stay server-side,
but it's safer to store them as Worker secrets (`npx wrangler secret put
SUPABASE_SECRET_KEY`, and likewise `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `CRON_SECRET`), then build from
a checkout that has no `.env.local`.

### Known Cloudflare Workers blockers (found 9 Nov 2026, not yet fixed)

Probing every API route in the local Workers runtime (`wrangler dev`) after
`npx opennextjs-cloudflare build` showed:

| Problem | Effect on Workers |
|---|---|
| ~~`sharp` is a native module and can't load in Workers~~ **Fixed 10 Nov 2026:** `src/server/imaging/processor.ts` uses the `IMAGES` binding on Workers and sharp (loaded on demand) on Node; sizes, EXIF orientation and alpha come from `src/server/imaging/header.ts` | Was: every route importing image processing answered 500 |
| ~~pdfkit's Node build can't be bundled for Workers (`No such module "#standard-fonts/Helvetica"`)~~ **Fixed 10 Nov 2026:** `scripts/patch-pdfkit-workerd.mjs` (runs on `npm install` and before `deploy`/`preview`/`upload`) adds a `"workerd"` export condition to pdfkit 0.20.1 pointing at a generated `js/pdfkit.workerd.mjs` (browser build with the 14 built-in fonts registered inside pdfkit, so react-pdf can't race it) and embeds its own fonts as data URLs. Guarded by `tests/pdf/pdfkit-workerd-patch.test.ts` | Was: catalogue PDF export and payment receipts failed on Workers |
| ~~react-pdf's layout engine (yoga-layout 3.2.1) compiles WebAssembly from base64 at runtime ("Wasm code generation disallowed by embedder")~~ **Fixed 10 Nov 2026:** `scripts/patch-yoga-workerd.mjs` (same hooks as the pdfkit patch) extracts the binary to `dist/binaries/yoga.wasm`, adds `dist/src/load.workerd.js` (passes the precompiled module to Emscripten's `instantiateWasm` hook) and a `"workerd"` condition on `yoga-layout/load`. Wrangler uploads `yoga.wasm` as a CompiledWasm module. Guarded by `tests/pdf/yoga-workerd-patch.test.ts` | Was: every PDF failed on Workers after the pdfkit fix |
| Generation runs in `after()`, which on Workers becomes `ctx.waitUntil` and is stopped about 30 s after the response | OpenAI image calls (up to 140 s) would be cut off mid-generation |
| The crons exist only in `vercel.json`; `wrangler.jsonc` has no `triggers.crons` and the Worker has no `scheduled` handler | The stuck-job watchdog (which refunds credits), billing reconciliation and retention never run |

Fixing these means real porting work: Cloudflare Images (the `IMAGES` binding)
or WebAssembly instead of `sharp`, Queues or Workflows for generation, cron
triggers, and bundled PDF fonts. The alternative is to run the app on a Node
host (the Vercel setup in sections 3 and 7) and keep Cloudflare for DNS and CDN.

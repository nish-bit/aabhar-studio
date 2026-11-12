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

Never paste the database password into a command line, a config file, a
chat or a ticket. The steps below read it with a prompt instead.

1. **Get the session pooler host and user from Supabase.** Open the project,
   click **Connect** (top of the page) and choose **Session pooler**. Copy:
   - the host, e.g. `aws-0-<region>.pooler.supabase.com`. Copy it exactly:
     newer projects can be on `aws-1-…`, and a wrong host fails with
     "Tenant or user not found";
   - the user, which for the pooler is `postgres.<project-ref>` (not plain
     `postgres`). `<project-ref>` is the ID in the project URL
     `https://<project-ref>.supabase.co`;
   - port `5432` and database `postgres`.

   Use the session pooler (5432), not the transaction pooler (6543):
   Hyperdrive pools connections itself. The password is the **database**
   password (Project Settings → Database), not your Supabase login or an
   API key. After **Reset database password**, allow a minute or two before
   it works on the pooler.
2. **Check Supabase Network Bans.** After repeated failed logins, Supabase
   bans the client IP for a while, and even the right password keeps failing
   with `password authentication failed`. Look in Project Settings →
   Database → **Network Bans** and remove any ban before trying again. Don't
   retry a failing password in a loop: that renews the ban.
3. **Download and check the Supabase Root 2021 CA.** Project Settings →
   Database → SSL Configuration → **Download certificate**
   (`prod-ca-2021.crt`). Keep it outside git (`*.crt` is ignored). Check it
   is the real root (subject and issuer `CN=Supabase Root 2021 CA`, valid
   until 2031, SHA-256 starting `80:70:25:AD`):
   ```powershell
   node -e "const c=new (require('crypto').X509Certificate)(require('fs').readFileSync('prod-ca-2021.crt'));console.log(c.subject,'|',c.validTo,'|',c.fingerprint256)"
   ```
4. **Test the login locally, with the same TLS check Hyperdrive uses**
   (PowerShell, from the project folder; needs `psql`). `-W` makes psql
   prompt for the password, so it never appears in the command, the shell
   history or the environment. The query only reads your own session:
   ```powershell
   $env:PGHOST        = "<pooler-host>"            # from step 1
   $env:PGPORT        = "5432"
   $env:PGDATABASE    = "postgres"
   $env:PGUSER        = "postgres.<project-ref>"   # from step 1
   $env:PGSSLMODE     = "verify-full"
   $env:PGSSLROOTCERT = (Resolve-Path .\prod-ca-2021.crt).Path
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -W -c "select current_user, ssl, version from pg_stat_ssl where pid = pg_backend_pid();"
   Remove-Item Env:PGHOST, Env:PGPORT, Env:PGDATABASE, Env:PGUSER, Env:PGSSLMODE, Env:PGSSLROOTCERT
   ```
   | Result | Meaning |
   |---|---|
   | a row with `ssl = t` | password and certificate are right; use the same password in step 7 |
   | `password authentication failed` | wrong or not-yet-active password (or a ban: step 2) |
   | `Tenant or user not found` | wrong pooler host or user (step 1) |
   | `certificate verify failed` / root certificate error | wrong CA file or path (step 3) |
5. **Upload the CA to Cloudflare** and note the certificate ID it prints:
   ```powershell
   npx wrangler cert upload certificate-authority --ca-cert prod-ca-2021.crt --name supabase-root-2021
   ```
6. **Pick the origin connection limit.** Each Hyperdrive connection to the
   session pooler takes one client slot of the Supabase pool. Read the
   **Pool Size** in Project Settings → Database → Connection pooling, and
   choose a limit a few below it, leaving room for scripts, migrations and
   the Supabase dashboard. Above the pool size, requests fail with "max
   clients reached".
7. **Create the Hyperdrive config** with separate origin fields (no
   connection string, so nothing needs URL-encoding). The password is read
   with a masked prompt and passed as a variable, so PowerShell can't
   rewrite `$` or `` ` `` characters in it, and it isn't saved in the shell
   history:
   ```powershell
   $pw    = Read-Host "Supabase database password" -AsSecureString
   $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
   npx wrangler hyperdrive create aabhar-db `
     --origin-host <pooler-host> --origin-port 5432 `
     --database postgres --origin-user postgres.<project-ref> --origin-password $plain `
     --ca-certificate-id <certificate-id> --sslmode verify-full `
     --caching-disabled --origin-connection-limit <limit-from-step-6>
   Remove-Variable plain, pw
   ```
   - `--sslmode verify-full` with the uploaded CA: Hyperdrive checks the
     certificate chain **and** the host name. Don't use `require` (no
     verification).
   - `--caching-disabled`: by default Hyperdrive caches the results of read
     queries made outside transactions. The app reads job status, credit
     balances and payment state right after they change, so cached reads
     would show stale values.
   - Don't pass `--binding`/`--update-config`; add the binding by hand
     (step 8) so the change is reviewed.
8. **Add the binding to `wrangler.jsonc`** with the ID that step 7 prints
   (the ID isn't a secret; no password goes in the file):
   ```jsonc
   "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }]
   ```
9. **Local Workers preview** (`npm run preview`). With the binding in
   `wrangler.jsonc`, Wrangler needs a local database for it, which it reads
   from the environment variable
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (the suffix is
   the binding name). Point it at a local or development database, not
   production, and set it only in the current shell, never in
   `wrangler.jsonc` or a committed file:
   ```powershell
   $env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgres://postgres:postgres@127.0.0.1:5432/postgres"
   npm run preview
   Remove-Item Env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
   ```
10. After the next approved deploy, check that
    `https://www.aabharstudio.com/api/health` shows `"database": true`.

**Secrets.** OpenNext copies the `.env*` files present at build time into the
Worker bundle (`.open-next/cloudflare/next-env.mjs`), so today the server
secrets come from the build machine's `.env.local`. They stay server-side,
but it's safer to store them as Worker secrets (`npx wrangler secret put
SUPABASE_SECRET_KEY`, and likewise `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `CRON_SECRET`), then build from
a checkout that has no `.env.local`.

### Background generation (Queues) and scheduled jobs (Cron Triggers)

`wrangler.jsonc` points `main` at `worker.ts`, which wraps OpenNext's
generated worker (HTTP is served unchanged) and adds two handlers from
`src/worker/background.ts`:

- **queue**: `POST /api/generations` (and an admin retry) sends `{ jobId }` to
  the `aabhar-generation` queue (`src/server/generation/dispatch.ts`). The
  consumer calls `POST /api/internal/generation/run` through the
  `WORKER_SELF_REFERENCE` binding with `Authorization: Bearer
  $JOB_RUNNER_SECRET`; that route runs the unchanged `runGenerationJob`. The
  job's atomic claim (queued → processing) makes duplicate deliveries no-ops,
  and refunds are keyed per job (`refund:job:<id>`), so nothing is charged or
  refunded twice. A 5xx or network error is retried after 15, 30, 60, 120 and
  240 s; then the message goes to `aabhar-generation-dlq`, whose consumer logs
  `generation.dead_letter`, and the stuck-job watchdog refunds the job (it
  fails jobs still queued after 10 minutes, and processing jobs past their
  295 s lease). Off Workers (`next dev`, Vercel) jobs still run with `after()`.
- **scheduled**: each Cron Trigger calls the existing route with
  `Authorization: Bearer $CRON_SECRET`. Same UTC schedules as `vercel.json`:

  | Cron | Route |
  |---|---|
  | `*/10 * * * *` | `/api/cron/expire-jobs` (stuck-job watchdog and refunds) |
  | `17 * * * *` | `/api/cron/billing` (credit expiry, missed pack payments) |
  | `23 21 * * *` | `/api/cron/retention` (data retention) |

  The tasks are safe to repeat or overlap. A failed task is logged
  (`cron.failed`) and marks the scheduled run as failed in Cloudflare.

**Before the first build with this configuration is uploaded**, create both
queues (an upload fails if a bound queue doesn't exist). Queues are billed
per operation; check your plan first:
```powershell
npx wrangler queues create aabhar-generation
npx wrangler queues create aabhar-generation-dlq
```

Add the runner secret to a new, inactive version (32+ random characters; the
prompt doesn't echo it). Without it, `/api/internal/generation/run` answers
404 and queued jobs are refunded by the watchdog:
```powershell
npx wrangler versions secret put JOB_RUNNER_SECRET
```

**Going live.** `opennextjs-cloudflare upload` creates an inactive version and
doesn't change triggers. After deploying the version (`npx wrangler versions
deploy`), attach the Cron Triggers and the queue consumers to the Worker:
```powershell
npx wrangler triggers deploy
```
Deploy the version first: consumers attached while an older version (without
a `queue` handler) is live would fail every message.

### Known Cloudflare Workers blockers (found 9 Nov 2026, not yet fixed)

Probing every API route in the local Workers runtime (`wrangler dev`) after
`npx opennextjs-cloudflare build` showed:

| Problem | Effect on Workers |
|---|---|
| ~~`sharp` is a native module and can't load in Workers~~ **Fixed 10 Nov 2026:** `src/server/imaging/processor.ts` uses the `IMAGES` binding on Workers and sharp (loaded on demand) on Node; sizes, EXIF orientation and alpha come from `src/server/imaging/header.ts` | Was: every route importing image processing answered 500 |
| ~~pdfkit's Node build can't be bundled for Workers (`No such module "#standard-fonts/Helvetica"`)~~ **Fixed 10 Nov 2026:** `scripts/patch-pdfkit-workerd.mjs` (runs on `npm install` and before `deploy`/`preview`/`upload`) adds a `"workerd"` export condition to pdfkit 0.20.1 pointing at a generated `js/pdfkit.workerd.mjs` (browser build with the 14 built-in fonts registered inside pdfkit, so react-pdf can't race it) and embeds its own fonts as data URLs. Guarded by `tests/pdf/pdfkit-workerd-patch.test.ts` | Was: catalogue PDF export and payment receipts failed on Workers |
| ~~react-pdf's layout engine (yoga-layout 3.2.1) compiles WebAssembly from base64 at runtime ("Wasm code generation disallowed by embedder")~~ **Fixed 10 Nov 2026:** `scripts/patch-yoga-workerd.mjs` (same hooks as the pdfkit patch) extracts the binary to `dist/binaries/yoga.wasm`, adds `dist/src/load.workerd.js` (passes the precompiled module to Emscripten's `instantiateWasm` hook) and a `"workerd"` condition on `yoga-layout/load`. Wrangler uploads `yoga.wasm` as a CompiledWasm module. Guarded by `tests/pdf/yoga-workerd-patch.test.ts` | Was: every PDF failed on Workers after the pdfkit fix |
| ~~Generation runs in `after()`, which on Workers becomes `ctx.waitUntil` and is stopped about 30 s after the response~~ **Fixed in code 12 Nov 2026** (needs the queues below): on Workers the job goes to the `aabhar-generation` queue and the consumer runs it | Was: OpenAI image calls (up to 140 s) would be cut off mid-generation |
| ~~The crons exist only in `vercel.json`; `wrangler.jsonc` has no `triggers.crons` and the Worker has no `scheduled` handler~~ **Fixed in code 12 Nov 2026**: `worker.ts` handles the Cron Triggers (attach them with `wrangler triggers deploy`, below) | Was: the stuck-job watchdog (which refunds credits), billing reconciliation and retention never ran |

Fixing these means real porting work: Cloudflare Images (the `IMAGES` binding)
or WebAssembly instead of `sharp`, Queues or Workflows for generation, cron
triggers, and bundled PDF fonts. The alternative is to run the app on a Node
host (the Vercel setup in sections 3 and 7) and keep Cloudflare for DNS and CDN.

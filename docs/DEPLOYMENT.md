# Deployment runbook

Target: **GitHub → Cloudflare Workers Builds → Cloudflare Workers** (Next.js 16
through OpenNext, `@opennextjs/cloudflare`) with **Supabase** (auth, Postgres,
storage), **OpenAI** (image edits) and **Razorpay** (payments). Cloudflare
also hosts the domain and DNS. Vercel isn't used (section 11).

Follow the sections in order. Steps marked **(you)** need your accounts and
can't be done from the codebase.

---

## 0. Accounts and plans

| Service | Plan needed | Why |
|---|---|---|
| Cloudflare | **Workers Paid** | The Worker is about 5 MiB gzipped, above the Free plan's 3 MiB limit. Queues (background generation), Hyperdrive (database) and Cron Triggers are part of the setup (section 3). |
| Supabase | Pro recommended | Free projects pause after a week of inactivity. Pro allows point-in-time recovery. |
| OpenAI | API account with image-model access | See `docs/IMAGE_GENERATION_SETUP.md` (organisation verification may be required for GPT Image models). |
| Razorpay | Test mode first; live needs KYC and Subscriptions enabled | See `docs/BILLING.md`. |
| Google Cloud | Free | OAuth client for "Continue with Google" (`docs/AUTH_AND_PURCHASE.md`). |

Use separate **staging** and **production** Supabase projects and Razorpay
test/live keys. Previews never get the production database, queues,
secrets or crons, but they currently sign in against the production
Supabase project; see the warning in section 4.

## 1. GitHub (you)

1. Create a private repository and push this code. `.env*` files are
   git-ignored; only `.env.example` is committed.
2. Protect `main`: require the **CI** workflow (`.github/workflows/ci.yml`)
   to pass. CI runs on every pull request and on pushes to `main` (a push
   to another branch without a pull request doesn't run it). It runs:
   - type checking, lint and `npm audit` (production dependencies)
   - all tests, including the real-PostgreSQL concurrency and RLS suites
     against a disposable Postgres 17 service
   - a Next.js build and an OpenNext (Workers) build, with no secrets
   - every migration, one transaction per file, plus
     `scripts/verify-database.sql`
3. Don't require any Vercel check on `main` (section 11).
4. Enable secret scanning and Dependabot alerts.

## 2. Supabase (you)

**Database**

```bash
supabase link --project-ref <ref>
supabase db push                       # applies supabase/migrations in order
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-database.sql   # must print PASS
```

**Auth → Sign-in providers → Google**: customers sign in with Google
only. Follow `docs/AUTH_AND_PURCHASE.md` §Setup: create the Google OAuth
client, paste its Client ID and Secret here, and turn **Email** sign-in
off.

**Auth → URL configuration**
- Site URL: `https://<your-domain>`.
- Redirect URLs: `https://<your-domain>/auth/callback`, plus
  `http://localhost:3000/auth/callback` on the staging project only.

**Auth → SMTP**: not needed for sign-in any more (Google handles it).
Configure it anyway if you want Supabase's security emails to come from
your domain.

**Auth → Rate limits**: review the defaults. Consider CAPTCHA (Auth →
Bot protection) if sign-up abuse appears.

**Auth → MFA**: enable TOTP, and require it for anyone holding an admin
role.

**Database → Settings**
- Enforce SSL.
- Add Network Restrictions if you use a static egress.

**Database → Backups**: enable point-in-time recovery for production.

**Storage**: the migrations create four **private** buckets: `originals`,
`generated`, `brand-assets` and `catalogues`. Confirm none is public (the
verify script checks this).

**Region**: the production project is in `eu-north-1` (Stockholm). The
Worker runs in Cloudflare's data centres and reaches Postgres through
Hyperdrive (section 3.3), which pools connections close to the database.
Every API request makes several database round trips. Smart Placement isn't
configured; turning it on is a `wrangler.jsonc` change and needs review.

## 3. Cloudflare Workers: production (you)

The Worker is called `aabhar-studio`. Its configuration is `wrangler.jsonc`,
and `tests/unit/wrangler-config.test.ts` fails if the production bindings
change or if a Preview gains access to production resources. Production
has these bindings:

| Binding | What it is |
|---|---|
| `HYPERDRIVE` | The production database (section 3.3) |
| `GENERATION_QUEUE` + consumers of `aabhar-generation` and `aabhar-generation-dlq` | Background generation (section 3.4) |
| `WORKER_SELF_REFERENCE` | Lets the queue consumer call the Worker's own run route |
| `IMAGES` | Image transformations |
| `ASSETS` | Static files from `.open-next/assets` |
| `triggers.crons` | The three scheduled jobs (section 3.4) |
| `vars` | Public values only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `BILLING_LIVE_APPROVED` (`"false"`) |

`main` in `wrangler.jsonc` is `worker.ts`. It wraps the worker that OpenNext
generates (HTTP is served unchanged) and adds the queue and scheduled
handlers.

### 3.1 Workers Builds settings

Cloudflare → Workers & Pages → `aabhar-studio` → Settings → **Build**.

The repository can't read these settings, so each one says whether it was
checked. **UNVERIFIED** means it comes from this runbook's intended setup,
not from the dashboard. Copy the real values from the dashboard into this
table when you next check it.

| Setting | Intended value | Status (16 Nov 2026) |
|---|---|---|
| Git repository | `nish-bit/aabhar-studio` | Observed: Workers Builds reports on this repository's commits |
| Production branch | `main` | UNVERIFIED. Consistent with what's observed: `main` builds succeed while every other branch fails, so they run different commands |
| Builds for non-production branches | On (each branch gets a Preview, section 4) | Observed: branch commits get Workers Builds runs |
| Root directory | `/` (repository root) | UNVERIFIED |
| Build command | `npx opennextjs-cloudflare build && node scripts/deploy-guard.mjs --bundle` | UNVERIFIED. This command succeeds on a clean checkout of `f2e9036` |
| Deploy command (production, `main`) | Not decided; see below | **UNVERIFIED** |
| Non-production branch deploy command | `npx wrangler preview --ignore-base-config` | UNVERIFIED. Every branch build since `f101047` has failed; the build log has the reason |
| Build variables | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public values; Next.js writes them into the browser code at build time) | UNVERIFIED |
| Node.js | 22 (from `.nvmrc`) | UNVERIFIED |

- Workers Builds runs `npm ci` before the build command. The `postinstall`
  script applies the pdfkit and yoga-layout patches that the Workers bundle
  needs (section 10).
- `deploy-guard.mjs --bundle` fails the build if the bundle contains any
  value from an `.env*` file: OpenNext compiles `.env*` files into the
  Worker. A Workers Builds checkout has none.
- If you change the build variables, rebuild. The `vars` in
  `wrangler.jsonc` only reach the server, not code already built for the
  browser.

**Production deploy command: configured command UNVERIFIED.** The command
text in the dashboard hasn't been checked. What it does has been observed
(read-only, with `wrangler versions list` and `wrangler deployments list`,
16 Nov 2026):

- The last successful `main` build (14 Nov 2026) created version `4947515f`
  as a Wrangler **version upload**. It was not deployed.
- Every production deployment so far was made from the dashboard (or by
  changing a secret), not by Workers Builds. The version live on 16 Nov 2026
  is `b2682b5c`, deployed from the dashboard.
- So the configured command **uploads inactive versions**. It behaves like
  `npx wrangler versions upload` or `npx opennextjs-cloudflare upload`,
  but which of the two (or another command) is set is UNVERIFIED.
- On 15 Nov 2026 the `aabhar-generation` queue had no consumer attached,
  which matches this: uploads don't attach queue consumers or Cron Triggers.

Record the exact command here once it's been read from the dashboard.

**Alternative deployment methods.** These are options, not the current
setting:

| Command | Effect |
|---|---|
| `npx opennextjs-cloudflare upload` | Uploads an **inactive** version. You check it, then promote it (dashboard, or `npx wrangler versions deploy`). Queue consumers and Cron Triggers aren't applied: run `npx wrangler triggers deploy` after promoting (section 3.4). |
| `npx opennextjs-cloudflare deploy` | Deploys every push to `main` straight to production. Also applies the queue consumers and Cron Triggers from `wrangler.jsonc`. |

After any change, check Settings → Triggers and Queues → `aabhar-generation`.

Don't use `npm run deploy` or `npm run upload` as the Workers Builds deploy
command: they rebuild. From a developer machine, both scripts refuse to run
while `.env*` or `.dev.vars*` files exist (`scripts/deploy-guard.mjs`), so
release through Workers Builds.

### 3.2 Runtime variables and secrets

Set secrets in Settings → Variables and Secrets (type **Secret**), with
`npx wrangler secret put <NAME>` (this deploys a new version straight away),
or with `npx wrangler versions secret put <NAME>` (this creates an inactive
version). Never put a secret in `wrangler.jsonc`, a build variable or an
`.env*` file on a build machine. `keep_vars: true` keeps plain-text values
set in the dashboard across deploys.

| Name | Type | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `vars` in `wrangler.jsonc` + build variables | Public |
| `BILLING_LIVE_APPROVED` | `vars` in `wrangler.jsonc` | `"false"`. Live Razorpay stays off until a reviewed commit changes it (`docs/BILLING.md`) |
| `SUPABASE_SECRET_KEY` | Secret | Server only; never exposed to the browser |
| `OPENAI_API_KEY` | Secret | |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Secret | Test keys until live billing is approved |
| `CRON_SECRET` | Secret | `openssl rand -hex 32`; used by the Cron Triggers |
| `JOB_RUNNER_SECRET` | Secret | 32+ random characters; used by the queue consumer |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_TIMEOUT_MS`, `GENERATION_MAX_ACTIVE_JOBS`, `GENERATION_DAILY_LIMIT`, `PUBLIC_SITE_URL`, `MARKETING_*` | Optional plain text | See `.env.example` |

The Worker doesn't use `DATABASE_URL`, `DATABASE_POOL_MAX` or
`DATABASE_SSL_CA`: it connects only through the `HYPERDRIVE` binding. Those
three are for Node (local development, scripts and tests).
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` is only for a local
`npm run preview` (section 3.3, step 9). Never set it on the deployed Worker.

### 3.3 Database (Hyperdrive)

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

The production binding already exists in `wrangler.jsonc`. These steps
create a Hyperdrive config from scratch, or replace it.

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
9. **Local Workers preview** (`npm run preview`, nothing is uploaded). With
   the binding in `wrangler.jsonc`, Wrangler needs a local database for it,
   which it reads from the environment variable
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (the suffix is
   the binding name). Point it at a local or development database, not
   production, and set it only in the current shell, never in
   `wrangler.jsonc`, the Worker's settings or a committed file:
   ```powershell
   $env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgres://postgres:postgres@127.0.0.1:5432/postgres"
   npm run preview
   Remove-Item Env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
   ```
10. After the next approved deploy, check that
    `https://www.aabharstudio.com/api/health` shows `"database": true`.

### 3.4 Background generation (Queues) and scheduled jobs (Cron Triggers)

`worker.ts` adds two handlers from `src/worker/background.ts`:

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
  295 s lease). Without the queue binding (`next dev`, Node, Previews), jobs
  run with `after()` instead.
- **scheduled**: each Cron Trigger calls the existing route with
  `Authorization: Bearer $CRON_SECRET` (UTC schedules):

  | Cron | Route | Purpose |
  |---|---|---|
  | `*/10 * * * *` | `/api/cron/expire-jobs` | Stuck-job watchdog: fails and refunds stuck jobs |
  | `17 * * * *` | `/api/cron/billing` | Expires credits; reconciles unconfirmed pack payments |
  | `23 21 * * *` | `/api/cron/retention` | Data retention, daily at 02:53 IST (`docs/PRIVACY.md`) |

  The tasks are safe to repeat or overlap. A failed task is logged
  (`cron.failed`) and marks the scheduled run as failed in Cloudflare. If the
  crons don't run, stuck jobs keep holding the generation slot and their
  credits aren't refunded.

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

**Going live with uploaded versions.** `opennextjs-cloudflare upload` (and
`wrangler versions upload`) create an inactive version and don't change
triggers. After deploying the version (`npx wrangler versions deploy`),
attach the Cron Triggers and the queue consumers to the Worker:
```powershell
npx wrangler triggers deploy
```
Deploy the version first: consumers attached while an older version (without
a `queue` handler) is live would fail every message. With
`opennextjs-cloudflare deploy` as the production deploy command (section
3.1), this happens on every deploy.

### 3.5 Domain and HTTPS

`www.aabharstudio.com` is the canonical host (canonical tags, sitemap,
Supabase and Razorpay URLs).

1. **Workers & Pages → `aabhar-studio` → Settings → Domains & Routes:**
   attach `www.aabharstudio.com` as a **Custom Domain**. Cloudflare creates
   the DNS record and the certificate. Don't add routes or custom domains in
   `wrangler.jsonc`; the config test forbids them.
2. **Apex:** `aabharstudio.com` must redirect to `https://www.aabharstudio.com`
   with a 301 or 308, for example with a Cloudflare Redirect Rule, not the
   reverse. Check the current setup in the dashboard before changing it.
3. **HTTPS:** turn on **Always Use HTTPS** (SSL/TLS → Edge Certificates).
   The app sends HSTS (2 years, subdomains). Submit the domain to the HSTS
   preload list only once every subdomain serves HTTPS.
4. **DNS:** keep the `TXT` record for Google Search Console and any email
   (`MX`) records.
5. **Robots policy:** the app's rules are in `src/app/robots.ts` (search
   crawlers allowed, AI-training crawlers blocked). If AI Crawl Control's
   managed robots.txt is on, Cloudflare adds its own rules to the app's file.
   Check that `https://www.aabharstudio.com/robots.txt` shows the combination
   you want.

## 4. Previews: non-production branches (you)

Every push to a branch other than `main` is built with the same build
command and deployed with `npx wrangler preview --ignore-base-config` as a
**Worker Preview** (open beta). This doesn't change the production Worker or
its active version. `wrangler preview` uses only the `previews` block of
`wrangler.jsonc`: nothing is inherited from the top-level config.
`--ignore-base-config` also ignores the Preview base config set in the
dashboard.

**Previews must stay isolated from production.** The `previews` block, as
enforced by `tests/unit/wrangler-config.test.ts`, has:

| Resource | In a Preview |
|---|---|
| Production database (`HYPERDRIVE`) | **None** |
| Queues (`aabhar-generation` producer or consumers) | **None** |
| `WORKER_SELF_REFERENCE` or other services | **None** |
| Cron Triggers | **None** (Previews can't have them) |
| Routes or custom domains | **None**; a Preview gets its own preview URL |
| Secrets | **None.** Preview secrets are separate from production (`npx wrangler preview secret`). Never copy production secrets into them |
| Variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public) and `BILLING_LIVE_APPROVED="false"` |
| Bindings | `IMAGES` (stateless image transformations; holds no data) |

> **Warning: Previews currently sign in against the production Supabase
> project.** The `NEXT_PUBLIC_SUPABASE_URL` and
> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the `previews` block are the
> production project's values.
>
> - A Google sign-in on a Preview uses production Supabase Auth. It can
>   **create a real production account**, or sign in to an existing one.
> - Sessions on a Preview are real production sessions for that account.
> - The Preview has no database binding and no secret key, and RLS still
>   applies, so it can't read or change production data directly. Only the
>   accounts themselves are created.
>
> **Before anyone outside the team tests Previews**, create a separate
> **staging** Supabase project (section 2) and point the `previews` block at
> it. That is a reviewed `wrangler.jsonc` change. The browser code takes the
> same two values from the Workers Builds **build variables** at build time,
> so Preview builds also need build variables that point at staging. Check
> whether Workers Builds lets non-production builds use different values
> from production before relying on this. Until then, keep Preview URLs
> private (for example behind Cloudflare Access) and use only team accounts
> on them.

What this means for testing on a Preview:
- Pages and sign-in work. Anything that needs the database (studio,
  generation, catalogues, billing and admin data) answers 503
  (`database.not_configured`). That's expected.
- Preview URLs are public unless you protect them (for example with
  Cloudflare Access).
- Wrangler names the Preview after the branch (`WORKERS_CI_BRANCH`). If
  Cloudflare rejects a branch name containing `/` (for example
  `preview/oauth-security-fix`), add `--name <name-without-slashes>` to the
  non-production deploy command.

Any change to the `previews` block must keep these rules, and the config
test must keep passing.

## 5. Image provider (you)

Set `OPENAI_API_KEY` as a Worker secret (section 3.2) and optionally
`OPENAI_IMAGE_MODEL`. Generate one real image, following
`docs/IMAGE_GENERATION_SETUP.md`, and approve the result before launch.
Set an OpenAI usage limit and billing alert.

## 6. Payments sandbox (you)

Follow `docs/BILLING.md` §3–§4:
- test keys and the test webhook to `https://<host>/api/webhooks/razorpay`.
  Previews have no database (section 4), so the webhook must point at a
  deployment that has one.
- `npm run billing:sync -- --apply`
- then the full sandbox lifecycle checklist

Keep `BILLING_LIVE_APPROVED="false"` until you approve live billing.

Also confirm that Razorpay Checkout opens and completes under the site's
Content-Security-Policy. The policy allows `*.razorpay.com`; Razorpay
doesn't publish an exact list.

## 7. Admin access

```bash
npm run admin:role -- grant you@yourdomain.com admin "Founder"
```

The person must have signed in once. Use an admin account with MFA.

## 8. Monitoring and operations

- **Errors:** every uncaught server error is logged as one JSON line,
  `event: "request.error"`, with the route, digest and release. Only the
  path is logged, never query strings, headers or bodies. Errors are
  written with `console.error`. Workers Logs is on (`observability` in
  `wrangler.jsonc`): query the lines in the dashboard, or export them
  (Logpush or a Tail Worker) to your error tool.

  Alert on `request.error`, `billing.webhook_failed`,
  `billing.webhook_bad_signature` (in bursts), `generation.provider_error`
  with category `auth` or `quota_exceeded`, `generation.dead_letter`,
  `cron.failed` and `user.auth_ban_failed`. `docs/BILLING.md` §6 lists the
  billing events.
- **Release tag:** the release in logs and `/api/health` comes from
  `VERCEL_GIT_COMMIT_SHA`, which Workers doesn't set, so it shows `null`.
  Use the version ID in the dashboard (Deployments) instead.
- **Uptime:** monitor `GET /api/health`, which returns 503 when the
  database is unreachable. It reports booleans only.
- **Business and operations metrics:** `/admin` shows users, generations,
  success rate, provider cost, failures by error code, stuck jobs, webhook
  problems, revenue (test and live shown separately) and MRR.
  `/admin/billing` → Health shows the billing checks.
- **Browser errors** aren't reported anywhere yet. Add Sentry's browser
  SDK if you want them.

## 9. Smoke test after each production deploy

1. `GET /api/health` returns 200 with `"database": true`.
2. Sign up with a new Google account: you land in the studio and the trial
   credits appear.
3. Upload a photo, generate one image, and compare and download it.
4. Build a catalogue with that image and export the PDF.
5. Check `/admin` loads for your admin account and 404s for a customer
   account.
6. Payments, in test mode only: buy a pack, then check the receipt and the
   webhook event in `/admin/billing?tab=webhooks`.
7. Settings → Triggers lists the three crons, and Queues →
   `aabhar-generation` shows the Worker as its consumer.

---

## 10. Workers compatibility fixes (history)

Probing every API route in the local Workers runtime (`wrangler dev`) after
`npx opennextjs-cloudflare build`, on 9 Nov 2026, found these problems. All
are fixed:

| Problem | Effect on Workers |
|---|---|
| ~~`sharp` is a native module and can't load in Workers~~ **Fixed 10 Nov 2026:** `src/server/imaging/processor.ts` uses the `IMAGES` binding on Workers and sharp (loaded on demand) on Node; sizes, EXIF orientation and alpha come from `src/server/imaging/header.ts` | Was: every route importing image processing answered 500 |
| ~~pdfkit's Node build can't be bundled for Workers (`No such module "#standard-fonts/Helvetica"`)~~ **Fixed 10 Nov 2026:** `scripts/patch-pdfkit-workerd.mjs` (runs on `npm install` and before `deploy`/`preview`/`upload`) adds a `"workerd"` export condition to pdfkit 0.20.1 pointing at a generated `js/pdfkit.workerd.mjs` (browser build with the 14 built-in fonts registered inside pdfkit, so react-pdf can't race it) and embeds its own fonts as data URLs. Guarded by `tests/pdf/pdfkit-workerd-patch.test.ts` | Was: catalogue PDF export and payment receipts failed on Workers |
| ~~react-pdf's layout engine (yoga-layout 3.2.1) compiles WebAssembly from base64 at runtime ("Wasm code generation disallowed by embedder")~~ **Fixed 10 Nov 2026:** `scripts/patch-yoga-workerd.mjs` (same hooks as the pdfkit patch) extracts the binary to `dist/binaries/yoga.wasm`, adds `dist/src/load.workerd.js` (passes the precompiled module to Emscripten's `instantiateWasm` hook) and a `"workerd"` condition on `yoga-layout/load`. Wrangler uploads `yoga.wasm` as a CompiledWasm module. Guarded by `tests/pdf/yoga-workerd-patch.test.ts` | Was: every PDF failed on Workers after the pdfkit fix |
| ~~Generation runs in `after()`, which on Workers becomes `ctx.waitUntil` and is stopped about 30 s after the response~~ **Fixed in code 12 Nov 2026:** on Workers the job goes to the `aabhar-generation` queue and the consumer runs it (section 3.4) | Was: OpenAI image calls (up to 140 s) would be cut off mid-generation |
| ~~The Worker had no cron schedules and no `scheduled` handler~~ **Fixed in code 12 Nov 2026:** `wrangler.jsonc` has `triggers.crons` and `worker.ts` handles them (section 3.4) | Was: the stuck-job watchdog (which refunds credits), billing reconciliation and retention never ran |

## 11. Vercel (not used)

Aabhar Studio doesn't deploy to Vercel. If the Vercel GitHub integration is
still connected, every push creates failing Vercel checks: the crons in
`vercel.json` need a Vercel Pro plan. Disconnect it: on GitHub, remove the
Vercel app's access to this repository, or in each Vercel project choose
Settings → Git → Disconnect.

`vercel.json` and `.vercelignore` are only read by Vercel and have no effect
on the Worker. The cron schedules live in `wrangler.jsonc`.

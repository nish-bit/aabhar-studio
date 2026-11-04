# Deployment runbook

Target: **GitHub → Vercel** (Next.js 16) with **Supabase** (auth, Postgres,
storage), **OpenAI** (image edits) and **Razorpay** (payments).

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
   - `BILLING_LIVE_APPROVED=false` until you approve live billing.
   - `CRON_SECRET`: `openssl rand -hex 32`.
3. **Settings → Functions:** set the region to match Supabase. Keep Fluid
   compute on.
4. **Domains:**
   - Add `yourdomain.com` and `www`, and set the DNS records Vercel shows.
     Vercel issues and renews HTTPS certificates automatically.
   - Redirect `www` to the apex domain, or the reverse.
   - The app already sends HSTS (2 years, subdomains). Submit the domain
     to the HSTS preload list only once every subdomain serves HTTPS.
5. **Deployment protection:** protect preview deployments (Vercel
   Authentication) so staging isn't public.
6. **Crons** are read from `vercel.json`. All three call the app with
   `Authorization: Bearer $CRON_SECRET`:

   | Route | Schedule | Purpose |
   |---|---|---|
   | `/api/cron/expire-jobs` | every 10 minutes | Fails and refunds stuck jobs |
   | `/api/cron/billing` | hourly | Expires credits; reconciles unconfirmed pack payments |
   | `/api/cron/retention` | daily, 02:53 IST | Data retention (`docs/PRIVACY.md`) |

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

# Image generation — setup and testing

This phase adds real image editing: an authenticated shop owner uploads one
product photo, picks a style, generates an edited image with the OpenAI Images
API, reviews it next to the original, and approves, discards, regenerates or
downloads it. Credits are debited atomically and refunded automatically on
failure.

Without credentials the app runs in a labelled **integration-ready** state:
sign-in, uploads and generation show "not connected" notices, and nothing is
generated, simulated or charged.

---

## 1. Provider: what was verified

Checked against the official OpenAI docs on 2026-10-20:

- **Endpoint:** `POST /v1/images/edits` accepts reference images (PNG, WebP or
  JPG, each under 50 MB) plus a text prompt, and returns the edited image
  synchronously as base64 (`b64_json`). GPT image models don't return URLs, so
  there is no separate retrieval step. — [API reference](https://developers.openai.com/api/reference/python/resources/images/methods/edit)
- **Model:** `gpt-image-2.5-sunburst` (default), described by OpenAI as the
  choice where editing precision matters most; it supports the edits endpoint.
  — [model page](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- **`input_fidelity`:** only for `gpt-image-1` / `gpt-image-1.5`; the reference
  says to omit it for the gpt-image-2 family. The adapter handles this.
- **Usage:** responses can include token `usage`; the adapter estimates cost from
  it using the published per-token prices (`src/server/providers/image/pricing.ts`).
  If usage is missing, cost is stored as unknown rather than guessed.
- **Rate limits (default):** 20 images/minute on the first paid tier.
- **Organisation verification:** OpenAI may require it before GPT image models
  work. An unverified organisation returns 403, which the app reports as a
  provider auth error and refunds.

Jobs are synchronous at the provider, so there are no provider webhooks. The
call runs in the background after the API responds (`after()`), and the browser
polls job status.

---

## 2. One-time setup

### Supabase

1. Create a project (Mumbai region recommended).
2. Apply the migration — either the CLI:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   or paste `supabase/migrations/20261020000100_generation_core.sql` into the
   SQL editor and run it. It creates the tables, RLS policies, credit functions
   and two **private** buckets (`originals`, `generated`).
3. **Auth → Providers → Email:** enabled.
4. **Auth → Email Templates → Magic Link:** include the code, e.g.
   `Your sign-in code is {{ .Token }}`. The login screen asks for this 6-digit code.
5. **Project Settings → API Keys:** copy the URL, publishable key and secret key.

### OpenAI

1. Create an API key at platform.openai.com with access to image models.
2. Complete organisation verification if prompted.
3. Make sure the account has billing set up.

### Environment

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_SECRET_KEY and OPENAI_API_KEY
npm install
npm run dev
```

On Vercel, add the same variables in **Project → Settings → Environment
Variables**, plus `CRON_SECRET` for the stuck-job watchdog in `vercel.json`.
The generation route needs a 300-second function duration (`maxDuration = 300`),
which depends on your Vercel plan; on plans with a lower limit, reduce
`OPENAI_TIMEOUT_MS` and `JOB_LEASE_SECONDS` together.

---

## 3. Test with one real jewellery photograph

Pick a sharp photo of one piece — ideally one with countable stones and a
visible engraving or hallmark, so changes are easy to spot.

### Option A — provider only (fastest, no Supabase needed)

Runs the same validation, sanitising, prompt and adapter code as the app and
saves the real output next to your original:

```bash
OPENAI_API_KEY=sk-... npm run try-edit -- ./my-ring.jpg white-studio
OPENAI_API_KEY=sk-... npm run try-edit -- ./my-ring.jpg black-luxury "a little more space around the ring"
```

Results land in `tmp-output/` with the latency, token usage and estimated cost
printed. Each run is one billed API call.

### Option B — the full app

1. `npm run dev` and open http://localhost:3000/login.
2. Enter your email, then the 6-digit code from the email. A new account gets
   a shop and 3 trial credits.
3. You land on **/app/studio**. Drop in your photo; it's uploaded straight to
   private storage, checked (real file type, size, under 40 MP; no minimum resolution)
   and re-encoded without EXIF/GPS metadata.
4. Choose a style (White Studio, Warm Ivory, Black Luxury, Velvet, Marble or
   Editorial), optionally add notes about background or lighting, and press
   **Generate**. The balance drops by the style's cost immediately.
5. The status panel shows the real server state (Sending → Queued → Editing)
   with an elapsed timer — no fake percentage.
6. When done, compare **side by side** or with the **slider**, then:
   - **Approve** marks it approved,
   - **Download** fetches it through a 2-minute signed URL,
   - **Regenerate** charges again and keeps the previous version below,
   - **Discard** hides it.

### What to check in the result

Compare against the original, zoomed in:

- [ ] Same number of stones, in the same positions and sizes
- [ ] Same gemstone colours
- [ ] Same metal colour and finish (yellow stays yellow, rose stays rose)
- [ ] Engravings, hallmarks and filigree intact
- [ ] Same proportions, clasp, chain and setting
- [ ] Nothing added (extra stones, hands, text)

The prompt instructs the model to keep all of these unchanged, but AI edits can
still alter details. That's why every result is marked "Needs review" and the
UI asks users to inspect it before publishing.

### Verify the bookkeeping

In the Supabase SQL editor:

```sql
-- the job, its status, model, estimated cost and token usage
select id, status, preset_slug, model, credit_cost, refunded, cost_usd_micros / 1e6 as est_cost_usd, usage, error_code
from generation_jobs order by created_at desc limit 5;

-- every provider call, including failed attempts
select job_id, attempt_no, outcome, error_code, latency_ms, provider_request_id, cost_usd_micros
from job_attempts order by id desc limit 10;

-- credits: the balance always equals the ledger sum
select b.balance, (select sum(amount) from credit_ledger l where l.shop_id = b.shop_id) as ledger_sum
from credit_balances b;
```

To see a refund, temporarily set `OPENAI_API_KEY` to an invalid `sk-...` value,
generate once, and check the job is `failed`, `refunded = true`, and the
balance is back where it was.

---

## 4. Automated tests

```bash
npm test
```

- `tests/unit/openai-provider.test.ts` — request shape and error mapping
  against mocked OpenAI responses (success, usage/cost, 429 with Retry-After,
  quota, 401/403, moderation, 400, 5xx, network, malformed body, timeout).
- `tests/unit/validate.test.ts` — magic bytes, type mismatch, size and
  dimension limits, EXIF stripping.
- `tests/unit/prompts.test.ts` — fidelity rules always present; user notes
  fenced and sanitised.
- `tests/integration/generation-flow.test.ts` — upload → generate → review →
  download through the real adapter with mocked HTTP: single charge,
  idempotent replay, retry then success, refund once, ownership, limits, late
  results after a timeout.
- `tests/db/migration.test.ts` — runs the real SQL migration in embedded
  Postgres (PGlite): trial grant, atomic debit, replay, limits, guarded
  transitions, refund-at-most-once, append-only ledger, function permissions
  and RLS isolation.

---

## 5. Known limits of this phase

- **HEIC** isn't accepted yet (the bundled image library can't decode it).
  iPhone users can choose "Most Compatible" or export as JPG.
- Background work uses `after()` within the request's time budget. If the
  function is killed mid-generation, the watchdog (cron, and every status
  check) fails the job and refunds it. A durable queue (decision D1) replaces
  this in the batch phase.
- One shop per user, created at sign-up.
- Rate limiting is database-based (uploads per 10 minutes, concurrent jobs,
  daily cap); Redis-based limits come with the API hardening phase.
- Cost figures are estimates from published prices; reconcile with the OpenAI
  usage dashboard before using them for pricing decisions.

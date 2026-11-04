# Billing (Razorpay)

Plans, credit packs, a credit ledger and server-enforced plan limits, paid
through Razorpay Subscriptions (monthly plans) and Orders (one-time packs).

> **Status: test mode only.** Live keys are refused unless
> `BILLING_LIVE_APPROVED=true`. Prices are placeholders marked
> "Indicative" until `billingConfig.pricesApproved = true`. Nothing here has
> been run against Razorpay's real sandbox yet; that's the first step below.

---

## 1. What you decide (needs your approval)

Everything lives in **`src/config/billing.ts`**:

| Setting | Current placeholder | Notes |
|---|---|---|
| Trial | 3 credits, valid 30 days | Synced to `billing_settings`; applies to new sign-ups only |
| Starter / Growth / Premium | ₹999 / ₹2,499 / ₹6,999 a month · 100 / 300 / 1,000 credits | **Not on sale** (removed from the site 3 Nov 2026). Config and backend kept so any existing subscription keeps working; there were none |
| Pack holders | All six styles; 25 catalogues × 100 products, 300 images/day, 3 at once (`packLimits`) | Applies once a shop has a captured pack payment |
| Plan limits | concurrency, per-day, catalogues, products per catalogue, styles | Enforced server-side |
| Credit packs | Solo 20 / Signature 75 / Studio 500 credits at ₹1,499 / ₹3,999 / ₹19,999, valid 365 days | Replaced the 50/200/500 packs on 3 Nov 2026; old packs are deactivated by the sync, not deleted |
| Plan credit policy | expire at the end of the billing month | No rollover |
| Lapsed limits | 1 running, 50/day, 1 catalogue × 12, basic styles | Applies when halted, or after a cancelled plan's period ends |
| GST | `pricesIncludeGst: true`, 18% | **Confirm with your accountant.** Checkout always charges exactly the listed price; this flag only changes the wording. If prices should be *ex*-GST, the listed prices must be raised to the GST-inclusive amount |
| Receipts | prefix `AS`, seller details empty | Receipts say "Seller details not yet configured" and "not a tax invoice" until you fill in legal name, address and GSTIN. GST tax invoices are out of scope |
| `subscriptionTotalCount` | 120 monthly cycles | Razorpay requires a finite count |

Refund policy is yours to set: refunds are issued from the Razorpay
Dashboard, and the app removes the matching share of credits automatically
(see §5).

---

## 2. Recurring-payment requirements

From Razorpay's Subscriptions documentation. Confirm each point with
Razorpay for your account before going live.

1. **Subscriptions must be enabled** on your Razorpay account, in both test
   and live mode. Live activation needs a KYC-complete account; Razorpay may
   review your business before enabling recurring payments.
2. **Payment methods.** Customers authorise a mandate at checkout: a card
   e-mandate, UPI Autopay or an eMandate (netbanking/debit card). Not every
   card issuer supports e-mandates. Checkout only offers what your account
   and the customer's bank support.
3. **Mandate limits.** RBI rules allow automatic debits up to ₹15,000 per
   charge without the customer re-authenticating (higher for some
   categories). Every plan here is below that. A future plan above ₹15,000
   would need extra customer authentication on every charge.
4. **Pre-debit notifications.** Customers must be notified before each
   automatic debit. Subscriptions are created with `customer_notify: 1`, so
   Razorpay sends these. Confirm the timing and channels for your account.
5. **Authentication charge.** A subscription that starts immediately takes
   the first month's amount as its authorisation payment. The customer sees
   one charge, and `subscription.charged` follows.
6. **Plan changes.** Razorpay doesn't allow plan updates on UPI or eMandate
   subscriptions. The app catches the error and tells the customer to cancel
   at period end and resubscribe. Card subscriptions switch at the next
   renewal (`schedule_change_at: cycle_end`), with no proration.
7. **Failed renewals.** Razorpay retries automatically. The subscription is
   `pending` while it retries and `halted` once retries run out. A halted
   subscription returns to active only if a charge succeeds. A *cancelled*
   subscription can never be restarted.
8. **Webhooks are required.** Renewals, retries, halts and refunds reach the
   app only through webhooks.

---

## 3. Setup (test mode)

```bash
# 1. Apply migrations (adds 20261020000250_ledger_expiry and 20261020000300_billing)
supabase db push            # or run the SQL files in order

# 2. Test keys in .env.local
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=<a long random string you also enter in the Dashboard>
BILLING_LIVE_APPROVED=false
CRON_SECRET=<random 16+ chars>

# 3. Copy plans/packs to the database and create Razorpay Plans (test mode)
npm run billing:sync              # dry run: prints what would change
npm run billing:sync -- --apply
```

**Webhook** (Dashboard → Test Mode → Account & Settings → Webhooks → Add):

- URL: `https://<your-host>/api/webhooks/razorpay`. Razorpay won't deliver
  to `localhost`, so locally use a tunnel (e.g. zrok, cloudflared, ngrok) or
  a Vercel preview deployment.
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`.
- Events:
  - `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`
  - `subscription.authenticated`, `subscription.activated`,
    `subscription.charged`, `subscription.pending`, `subscription.halted`,
    `subscription.paused`, `subscription.resumed`, `subscription.cancelled`,
    `subscription.completed`, `subscription.updated`
  - `refund.created`, `refund.processed`, `refund.failed`
- In test mode the Dashboard may ask for an OTP when you save a webhook.
  Razorpay's test-mode docs give the code.

**Cron.** `vercel.json` calls `/api/cron/billing` hourly with
`Authorization: Bearer $CRON_SECRET`. It expires lapsed credits and confirms
any pack payment whose webhook never arrived.

---

## 4. Sandbox lifecycle test plan

Run all of this in **test mode** before asking to go live. Use Razorpay's
test cards and UPI IDs from its testing docs. Tick each item off in the app
**and** in the Razorpay Dashboard.

**Packs**
- [ ] Buy a pack with a test card → "Payment confirmed", balance up, "Paid" in billing history, receipt downloads and shows TEST MODE.
- [ ] In Dashboard → Webhooks, the `payment.captured` / `order.paid` deliveries return 200 with `pack_already_granted` (verify got there first). Balance unchanged.
- [ ] Fail a payment (failure test card), then close Checkout → "Payment didn't go through". No credits.
- [ ] Close Checkout without paying → "Checkout closed. You haven't been charged."
- [ ] Re-deliver a webhook from the Dashboard → response `duplicate`. No change.

**Subscriptions**
- [ ] Subscribe to Starter with a test card → plan Active, 100 credits expiring at the period end, limits match Starter.
- [ ] Dashboard → Subscriptions → *Charge this now* (Success) → `subscription.charged` → another 100 credits; the history shows a second payment.
- [ ] *Charge this now* (Failure) → `subscription.pending` → plan card says "Renewal payment failed", limits unchanged, failed row in history.
- [ ] Fail repeatedly until halted (4 failures in test mode) → "Plan paused after failed payments", lapsed limits, existing credits still usable.
- [ ] From halted, subscribe again → old subscription cancelled, new one active.
- [ ] Change plan (card subscription) → "From next renewal" badge. Charge now → new plan's credits and limits.
- [ ] Test a UPI Autopay subscription and try to change plan → "can't switch plans automatically" message.
- [ ] Cancel → "won't renew", access until period end. After `subscription.cancelled` the status shows "Ends soon".

**Refunds**
- [ ] Full refund of a pack from the Dashboard → after `refund.processed`, the credits are removed and the payment shows "Refunded".
- [ ] Partial refund after spending some credits → proportional removal. `billing_refunds.credits_shortfall` records what had already been spent.

**Security checks**
- [ ] `curl -X POST .../api/webhooks/razorpay -d '{}'` → 400 (bad signature).
- [ ] As an editor (not owner), buy/subscribe → 403.
- [ ] Try a style outside the plan (e.g. Velvet on Starter) → "isn't included in your plan".

Razorpay's test-mode notes: card tokens expire after a few days, so finish
subscription tests promptly, and some update flows can't be repeated after a
manual charge. Use fresh subscriptions when needed.

---

## 5. How it works

```
Browser ──create order/subscription──▶ API (amount from server config)
   │                                         │
   └─ Razorpay Checkout ──handler()──▶ /verify: HMAC check ─▶ fetch payment from Razorpay
                                             │                       │ captured & amount matches?
                                             ▼                       ▼
                                     grant_credits(key)  ◀──── yes  (else "pending")
                                             ▲
Razorpay ──signed webhook──▶ /api/webhooks/razorpay ─▶ verify raw-body HMAC ─▶ inbox (event id) ─▶ same grant
```

- **Credits are granted only when Razorpay confirms capture.** Confirmation
  comes from a server-side API fetch after the Checkout signature verifies,
  or from a signed webhook. The browser's "success" is never enough.
- **Idempotent grants.** Each grant has a unique key:
  `grant:order:<order_id>` for packs, `grant:subpay:<payment_id>` for plan
  months. The verify call, webhook retries and duplicate deliveries can't
  grant twice.
- **Amount checks.** The payment's amount, currency and order (or Razorpay
  Plan) must match our own records, or nothing is granted.
- **Webhook inbox.** Events are keyed by the `X-Razorpay-Event-Id` header,
  stored, and row-locked while they're processed. A failure returns 500 so
  Razorpay retries. Events older than 7 days are ignored.
- **Out-of-order events.** A subscription event older than the last one
  applied is skipped. Ended subscriptions are never revived. Payment status
  only moves forward.
- **Credit lots.** `credit_grants` holds every grant (trial, plan, pack,
  refund_restore, legacy) with its own expiry. Generation spends the lots
  that expire soonest first and records allocations. A failed generation
  returns credits to the same lots, or to a fresh 30-day lot if the
  originals have expired.
- **The balance can't be edited by users.** `credit_balances`,
  `credit_grants`, the ledger and every billing table have INSERT, UPDATE and
  DELETE revoked from `anon` and `authenticated`. The money functions can be
  executed only by `service_role`. RLS gives members read access to their
  own shop only. Tests check all of this under Supabase's default grants.
- **No card data.** Only the payment method name (card, upi, …) and
  Razorpay ids are stored. Secrets stay in `src/server/**`. Checkout gets
  only the public key id.
- **Plan limits** (`src/server/billing/entitlements.ts`) are computed from
  subscription rows and applied in the generation service (styles,
  concurrency, per-day) and the catalogue service (catalogue count, products
  per catalogue).

Files: `src/config/billing.ts` · `src/server/billing/*` ·
`src/app/api/billing/**` · `src/app/api/webhooks/razorpay` ·
`src/app/api/cron/billing` · `src/features/billing/*` ·
`src/components/billing/*` · `src/app/(marketing)/pricing` ·
`src/app/(app)/app/billing` · `supabase/migrations/20261020000250_*`,
`…0300_billing.sql` · `scripts/billing-sync.ts` · `tests/billing/*`.

---

## 6. Going live (only after your approval)

1. Approve prices, GST treatment, trial, limits and refund policy. Set
   `pricesApproved: true` and fill in `receipts.seller`.
2. Complete every item in §4 in test mode.
3. Make sure Razorpay has enabled live Subscriptions on your account.
4. Generate live keys. Create a **separate live webhook** with its own
   secret and the same events.
5. Set the live env vars in production and `BILLING_LIVE_APPROVED=true`.
6. `npm run billing:sync -- --apply` with the live keys. This creates the
   live Razorpay Plans; test and live prices are stored separately.
7. Do one small real purchase, then refund it.

## 7. Known limitations

- Plan changes take effect at renewal only. There are no mid-cycle upgrades
  with proration.
- Refunds are started in the Razorpay Dashboard. There's no in-app refund
  button.
- Receipts are payment receipts, not GST tax invoices.
- Two simultaneous "create catalogue" requests can exceed the catalogue limit
  by one.
- If a subscription checkout is abandoned, the unpaid Razorpay subscription
  is cancelled the next time the shop subscribes.

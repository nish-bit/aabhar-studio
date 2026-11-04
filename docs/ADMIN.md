# Admin dashboard

`/admin` gives platform staff the following:

- users, shops and projects
- generation jobs and failures
- usage and provider costs
- credit transactions and promotional grants
- payments, subscriptions and webhook events
- plan limits, the trial and editing styles
- operational errors, with retries
- account disabling
- revenue and usage metrics

## Roles

| Role | Can |
|---|---|
| `admin` | Everything, including disabling accounts, granting credits, retrying jobs, and changing plans, the trial and presets |
| `support` | Read-only: every view, no changes |

Roles live in `public.platform_admins` and can only be granted with database access:

```bash
# The person signs in once first, so their account exists.
npm run admin:role -- grant you@example.com admin "Founder"
npm run admin:role -- grant helper@example.com support "Support desk"
npm run admin:role -- revoke helper@example.com
npm run admin:role -- list
```

No web request can create or promote an admin.

## How access is enforced

- **Verified session.** Every admin page and API resolves the user with
  Supabase `getUser()`, which is validated by the auth server. The user is
  then looked up in `platform_admins`. Roles are never read from the
  browser, a cookie or JWT claims.
- **Checked at every layer.** The `/admin` layout checks, each page checks
  again, each API route checks (`withAdmin`), and every write re-checks
  `assertWrite`. The buttons are hidden from support users only for
  convenience; a support user calling a write API gets **403**.
- **Hidden from everyone else.** Signed-out visitors get 401 (pages
  redirect to sign-in). Signed-in non-admins get **404**, so the admin area
  isn't revealed. A revoked role or a disabled account counts as not an
  admin.
- **CSRF.** Writes must come from the same origin (`Origin` header
  required and matched).
- **Database.** All admin tables are server-only. RLS is on with no
  policies, and privileges are revoked from `anon` and `authenticated`.
  Customers can't read or change `platform_admins`, the audit log, preset
  settings or moderation fields. Tests check this under Supabase's default
  grants.

## Audit trail

Every change asks for a written reason. It is recorded in
`admin_audit_log` in the same transaction as the change itself, along with
the actor, role, IP address, user agent and before/after details. The log
is append-only: a database trigger refuses updates and deletes. Viewing a
customer's account details is also recorded (`user.view`).

| Action | When |
|---|---|
| `user.view` | An admin opened a customer's account page |
| `user.disable` / `user.enable` | Account disabled or re-enabled |
| `user.auth_ban_failed` | The database disable worked, but the Supabase sign-in ban couldn't be applied |
| `credits.promo_grant` | Promotional credits granted |
| `job.retry` | A failed job was retried |
| `plan.update` / `plan.reset` | Plan limits or credits changed, or reset to the config values |
| `trial.update` | Trial allowance changed |
| `preset.update` | A style was switched on or off, or its credit cost changed |

## Customer privacy

The admin views carry metadata only:

- no photos or results, and no signed URLs or storage paths
- no customer prompt notes (shown only as "Yes, N characters")
- no catalogue contents
- no raw webhook payloads, which contain customer email and phone; only
  ids, amounts and statuses are extracted on the server
- no secrets of any kind

Tests check these responses for leaks.

## Actions and their rules

- **Disable account.** Takes effect immediately:
  - every customer API returns `account_disabled`
  - app pages show a notice
  - the SQL job function refuses new jobs
  - the user is banned at Supabase Auth on a best-effort basis

  Data and subscriptions are kept; cancel a subscription separately if
  needed. You can't disable yourself or an active admin (revoke the role
  first).
- **Grant credits.** 1 to 10,000 credits, with an optional expiry. The
  request is idempotent (one key per dialog). The customer sees
  "Promotional credits"; your reason stays internal.
- **Retry a failed job.**
  - Only for platform-side failures: timeout, rate limit, provider outage,
    not started, and similar. Content-blocked and invalid-input failures
    aren't retryable.
  - Conditions: the job failed within the last 14 days, its credits were
    refunded, the photo still exists, the requester still has edit access
    and isn't disabled, and the provider is configured.
  - The retry creates one new job, charged like a normal generation, and
    each job can be retried at most once.
- **Plans.** You can change limits (concurrency, per day, catalogues,
  products, styles) and monthly credits. Changes override
  `src/config/billing.ts` at runtime and on the public pricing page, and
  `billing:sync` won't overwrite them. "Reset" goes back to the config.
  Prices aren't editable here: they're Razorpay Plans, changed in the
  config and synced after approval (see `docs/BILLING.md`).
- **Trial.** Credits and validity for *new* sign-ups.
- **Presets.** Switch a style on or off, or change its credit cost (1–10).
  At least one style must stay enabled. Prompts stay in code.

## Recommended before production

- Require MFA for admin accounts in Supabase Auth, and keep admin accounts
  separate from shop owner accounts.
- Keep the number of `admin` roles small, and give support staff
  `support`.
- Review the audit log regularly; consider exporting it to your log
  pipeline.

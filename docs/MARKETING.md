# Marketing email consent

How Aabhar Studio records who agreed to marketing emails, and what has to
happen before any are sent. Nothing is sent today.

## Data

- **Email address:** not copied. It stays in Supabase `auth.users` (from Google sign-in).
- **`public.marketing_subscriptions`:** one row per user who has ever opted in (`user_id` is unique).
  - No row means the user never agreed.
  - Columns: status (`subscribed`, `unsubscribed`, or `pending`, which is reserved for double opt-in), the latest consent time, source and wording version, unsubscribe time and source, a secret unsubscribe token, and bounce/complaint suppression.
- **`public.marketing_consent_events`:** an append-only history of every change.
- **Access:** both tables are server only (RLS on, no policies, privileges revoked from `anon` and `authenticated`).
- **Migration:** `supabase/migrations/20261101000200_marketing.sql`. It only adds tables, and existing data is untouched.

## How consent is collected

- **Login page:** an optional checkbox, unticked by default, with the wording from `MARKETING_CONSENT` in `src/lib/marketing.ts`. Google sign-in leaves the site, so the choice travels to `/auth/callback` in a 15-minute first-party cookie. The callback records it once the user is known: source `signup` for accounts created in the last 10 minutes, `sign_in` otherwise.
- **`/app/settings/account`:** users can opt in or out here (source `settings`).
- **Unsubscribe link:** `/unsubscribe?token=…` needs no sign-in. Unsubscribing takes one button, so link scanners can't unsubscribe anyone by opening the link. Mail apps' one-click unsubscribe (RFC 8058) posts to `/api/marketing/unsubscribe?token=…`.
- **Changing the wording:** bump `MARKETING_CONSENT.version`. Cookies carrying an older version are ignored.

## Admin

`/admin/marketing` shows counts, the subscriber list, search by email, and a status filter.
- Any admin role can view it.
- The CSV export is a POST available to the `admin` role only, and each export is written to the audit log (`marketing.export`).
- The export contains eligible subscribers only: status `subscribed`, not suppressed, account not disabled, valid email.

Account deletion (`scripts/delete-account.ts`) also deletes the user's marketing records.

## Before sending anything

1. Choose a provider and write an adapter implementing `MarketingEmailProvider` (`src/server/marketing/campaigns.ts`). Return it from `marketingProvider()`.
2. Add the provider to the privacy policy's list of processors.
3. Set `PUBLIC_SITE_URL`, `MARKETING_EMAIL_PROVIDER` and, only when you mean it, `MARKETING_EMAILS_ENABLED=true`.
4. Point the provider's bounce/complaint webhook at a new route that verifies the provider's signature and calls `suppress()`.
5. Send with `sendCampaign()`. It mails eligible recipients only, and adds the unsubscribe link and one-click headers to every email.

Have the consent wording, privacy policy and process reviewed against the DPDP Act and Rules before launch.

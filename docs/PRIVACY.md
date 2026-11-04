# Privacy, retention and deletion

What the application stores, where, for how long, and how to delete a
customer's data. The draft public policy (`/legal/privacy`) is generated from
the same retention constants (`src/server/privacy/retention.ts`).

## Data map

| Data | Where | Who can read it |
|---|---|---|
| Email address, plus the name and profile picture Google shares at sign-in | Supabase Auth (`auth.users`, `auth.identities`) | The user; admins see the email (`/admin`) |
| Business profile (name, logo, phone, WhatsApp, email, website, address) | `business_profiles`, private `brand-assets` bucket | Shop members; admins see the shop name only |
| Uploaded photos | `originals` bucket, re-encoded with **all metadata removed**; the as-uploaded file is deleted after checking | Shop members (signed URLs, 10 minutes) |
| Generated images | `generated` bucket | Shop members |
| Prompt notes | `generation_jobs.instructions` | Shop members; admins see only whether notes exist and their length |
| Catalogues and exports | Database and private `catalogues` bucket | Shop members |
| Payments | Payment references, amounts, method type. **No card data** | Shop members; admins |
| Razorpay webhook payloads | `billing_webhook_events` (they include customer email and phone) | Server only; admins see ids, amounts and statuses only |
| Admin audit log | `admin_audit_log`, including admin IP and user agent | Admins |
| Request logs | Vercel (paths only from app code) | Operators |

Processors: Google (sign-in), Supabase, OpenAI (photo and notes, per generation), Razorpay
and Vercel. There are no analytics or advertising scripts, and the only
cookies are the sign-in session cookies.

## Retention (daily job, `/api/cron/retention`)

| What | When it's deleted |
|---|---|
| Uploads never completed (the raw file still has its original metadata) | 24 hours |
| Rejected uploads (rows) | 7 days |
| Results the customer discarded (file and row) | 30 days |
| Catalogue PDF/ZIP exports | 7 days (customers can re-export) |
| Large preview PDFs | 24 hours |
| Catalogues deleted by the customer | 30 days (restorable until then) |
| Webhook payloads | Redacted to ids, amounts and statuses after 30 days |
| Rate-limit counters | 24 hours |
| Approved results, their originals, active catalogues | While the account exists |
| Payments, receipts, subscriptions, credit ledger, audit log | Kept for accounting and security. Set the retention period with your accountant |

The job deletes storage files first and rows second, so a storage failure
is retried the next day and never leaves orphaned files behind.

## Deleting a customer's data (on request)

1. Verify the request comes from the account's email address.
2. Cancel any live subscription (Razorpay Dashboard or `/admin`).
3. Dry run, then apply:

```bash
npm run account:delete -- --email customer@example.com --admin you@example.com --reason "Request #123"
npm run account:delete -- --email customer@example.com --admin you@example.com --reason "Request #123" --apply
```

This deletes:
- every photo, result, catalogue, export and logo (files and rows)
- prompt notes and business details
- the shop name

It also replaces the sign-in email with a placeholder, blocks sign-in, and
writes `user.delete_data` to the audit log. Financial records are kept.
The script refuses to run while a subscription is live, or if the shop has
other members.

## Not implemented yet

- The deletion script clears the user's email and Google name/picture
  (`user_metadata`), but Supabase keeps a copy in the Google identity
  record (`auth.identities`). Removing that row as part of deletion is a
  follow-up; test it on staging first.

- A self-service "export my data" or "delete my account" button. Requests
  go to the privacy email.
- Automatic deletion of inactive accounts.

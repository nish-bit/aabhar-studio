# Sign-in and purchase flow

Customers sign in **only with Google**, through Supabase Auth's official
Google provider (OAuth with PKCE). There are no passwords, email codes or
magic links in the UI.

## How sign-in works

| Step | What happens | Where |
|---|---|---|
| 1 | The visitor clicks **Continue with Google** on `/login`. | `src/components/auth/google-sign-in.tsx` |
| 2 | `signInWithOAuth({ provider: "google" })` stores a PKCE verifier cookie and sends the browser to Google's account chooser (`prompt=select_account`, so shared shop computers don't silently reuse an account). | same |
| 3 | Google returns to Supabase, which returns to `/auth/callback?code=…&next=…`. | Supabase Google provider |
| 4 | The callback swaps the code for a session cookie on the server, then redirects to `next`. `next` is always a same-site path. | `src/app/auth/callback/route.ts`, `src/lib/safe-redirect.ts` |
| 5 | Errors go back to `/login?error=<code>` with a fixed message: cancelled, failed, expired, incomplete or unavailable. Provider text is never shown. | `src/lib/auth-flow.ts` (`LOGIN_ERRORS`) |

**Accounts**
- The first Google sign-in makes Supabase create one `auth.users` row. A
  trigger then creates the profile, a shop with the user as owner, and the
  trial credits (`app.handle_new_user`).
- Returning sign-ins reuse the same user ID, so nothing is duplicated
  (`tests/auth/google-accounts.test.ts`).
- If someone already has an account with the same verified email (for
  example from the earlier email-code login), Supabase links Google to
  that account automatically. Their images, credits and subscription are
  kept.

**Sessions and protection**
- Sessions are Supabase cookies, refreshed by `src/proxy.ts` and
  verified on every request with `getUser()`.
- When a session expires or is revoked, the next protected page sends the
  user to `/login`, keeping the page they were on.
- `/app/*` and `/admin/*` redirect signed-out visitors. All user APIs use
  `withUser`, which checks same-origin, a verified session and a
  non-disabled account. The user ID always comes from the session.

**Other**
- **Sign-out:** `POST /auth/sign-out`, from the app header.
- **Admins** sign in with Google too. Roles are still checked on the
  server from `platform_admins` by user ID. Grant one with
  `npm run admin:role -- grant you@gmail.com admin "Founder"` after that
  account has signed in once.

## Buying a plan while signed out

1. A paid plan on `/pricing` links to `/app/billing?plan=<id>`; packs use
   `?pack=<id>`.
2. The proxy sends the visitor to `/login?next=/app/billing?plan=<id>`,
   and the login page names the plan.
3. Google sign-in carries `next` through `/auth/callback`, so the user
   lands back on `/app/billing?plan=<id>` with the plan highlighted. It is
   never charged automatically.
4. Subscribe creates the Razorpay subscription with the price from server
   config. Verify checks the signature and the payment with Razorpay
   before granting credits. Webhooks handle renewals, failures and
   refunds (`docs/BILLING.md`).

Only the shop owner can pay. Row-level security limits billing, credits,
images and catalogues to the shop's members, and customers can't write
billing or credit tables.

## Setup

You need your Supabase project reference (from the project URL,
`https://<ref>.supabase.co`) and your production domain.

### 1. Google Cloud Console → Google Auth Platform

1. Create or pick a project.
2. **Branding:** app name, support email, logo, and links to
   `https://<domain>/legal/privacy` and `/legal/terms`.
3. **Audience:** External. While in Testing, only listed test users can
   sign in. Publish the app before launch.
4. **Data Access:** scopes `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`. Nothing more, so no Google verification
   review is needed.
5. **Clients → Create client → Web application**
   - Authorized JavaScript origins: `https://<domain>` and
     `http://localhost:3000`. Remove localhost before going live if you
     prefer.
   - Authorized redirect URIs: **the callback URL shown on Supabase's
     Google provider page**, normally
     `https://<ref>.supabase.co/auth/v1/callback`.
6. Copy the Client ID and Client Secret.

### 2. Supabase Dashboard

1. **Authentication → Sign In / Providers → Google:** enable it and paste
   the Client ID and Secret. The secret lives only here, never in this
   app's code or `.env`.
2. **Authentication → Sign In / Providers → Email:** turn it **off**.
   Otherwise the Supabase API would still accept email-code sign-ins sent
   directly to it.
3. **Authentication → URL Configuration**
   - Site URL: `https://<domain>`.
   - Redirect URLs: `https://<domain>/auth/callback`, and for local
     development `http://localhost:3000/auth/callback`. Use separate
     staging and production projects if you can.

App environment variables are unchanged: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design) and
`SUPABASE_SECRET_KEY` (server only).

### 3. Branding the Google account chooser

Google's chooser says "Choose an account to continue to
`<ref>.supabase.co`" because Google shows the domain it redirects back to,
which is Supabase's. There are two separate fixes, and neither is a code
change:

- **App name and logo:** Google shows the Branding name ("Aabhar Studio")
  and logo only after **brand verification** passes. Until then it shows
  just the domain. Verification needs:
  - a homepage on a domain you've verified in Google Search Console, which
    describes the app (not just a login page) and links to the privacy
    policy;
  - that same privacy policy URL on the Branding page, hosted on the same
    domain.
- **Domain:** to show your own domain instead of `<ref>.supabase.co`, add a
  Supabase **custom domain** (e.g. `auth.aabharstudio.com`). Then add the
  new `https://auth.<domain>/auth/v1/callback` to the Google client's
  redirect URIs *before* activating it, and keep the old one until every
  user is on the new domain.

Branding values for this app:

| Field | Value |
|---|---|
| App name | Aabhar Studio |
| User support email | aabharstudio@gmail.com |
| App logo | `public/brand/google-oauth-logo-120.png` (120×120 PNG of the current placeholder gem mark) |
| Application home page | `https://aabharstudio.com` |
| Privacy policy | `https://aabharstudio.com/legal/privacy` |
| Terms of service | `https://aabharstudio.com/legal/terms` |
| Authorized domains | `aabharstudio.com` (and `supabase.co` while the callback is on Supabase's domain) |
| Developer contact | your own email (Google sends policy notices there) |

Verification only passes once the app is actually served at that domain,
with the privacy policy published (not a draft).

### Before turning Email sign-in off

Accounts created with a non-Google email address (for example
`@rediffmail.com`) can't sign in once Email is off. They'd need a Google
account with that address, or you'd need to update their email in
Supabase first. Check **Authentication → Users** before switching.

## Tests

- `tests/auth/oauth-callback.test.ts` covers the callback:
  - a successful sign-in returns to the chosen plan
  - cancelled sign-in
  - provider errors (text not reflected)
  - a missing code
  - a rejected code
  - an expired flow
  - Supabase not configured
  - off-site `next` values
- `tests/auth/sign-in-flow.test.ts` covers:
  - the plan surviving sign-in
  - signed-out redirects
  - signed-in users skipping `/login`
  - error messages
- `tests/auth/google-accounts.test.ts` covers one profile, shop and trial
  per user, and no duplicates on return.
- `tests/billing/*` covers payment verification, ownership and webhooks.

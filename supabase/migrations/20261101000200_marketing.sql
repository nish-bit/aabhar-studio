-- =====================================================================
-- Marketing email consent.
--
-- One row per user who has ever opted in. No row means the user never
-- agreed, which is the same as not subscribed. The email address is not
-- copied here: it stays in auth.users (one source of truth, and account
-- deletion only has to change it in one place).
--
-- Every change is also appended to marketing_consent_events, the minimal
-- consent record: what changed, when, from where, and which wording the
-- user agreed to.
--
-- Server only, like the admin tables: RLS on with no policies, and table
-- privileges revoked from customers. Customers read and change their own
-- preference through /api/marketing/*, which checks the session first.
--
-- Additive only: nothing existing is altered or deleted.
-- =====================================================================

create table public.marketing_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles(id) on delete cascade,
  -- 'pending' is reserved for double opt-in, which isn't switched on yet.
  status              text not null check (status in ('subscribed', 'unsubscribed', 'pending')),
  -- The most recent opt-in. Kept after unsubscribing, as history.
  consent_at          timestamptz,
  consent_source      text check (consent_source in ('signup', 'sign_in', 'settings')),
  consent_version     text check (char_length(consent_version) <= 40),
  unsubscribed_at     timestamptz,
  unsubscribe_source  text check (unsubscribe_source in ('settings', 'unsubscribe_link', 'one_click', 'admin')),
  -- Secret for the no-login unsubscribe link: two random UUIDs, 244 random bits.
  unsubscribe_token   text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Set by the email provider's bounce/complaint webhook; suppressed addresses are never mailed.
  suppressed_at       timestamptz,
  suppression_reason  text check (suppression_reason in ('bounce', 'complaint')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status <> 'subscribed' or consent_at is not null)
);
create index marketing_subscriptions_status_idx on public.marketing_subscriptions(status, consent_at desc);

create table public.marketing_consent_events (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  action           text not null check (action in ('subscribed', 'unsubscribed', 'suppressed')),
  source           text not null check (source in ('signup', 'sign_in', 'settings', 'unsubscribe_link', 'one_click', 'admin', 'provider')),
  consent_version  text check (char_length(consent_version) <= 40),
  created_at       timestamptz not null default now()
);
create index marketing_consent_events_user_idx on public.marketing_consent_events(user_id, created_at desc);

-- Events are never edited. (Deleting is allowed, so an account deletion request can erase them.)
create function app.forbid_consent_event_update() returns trigger language plpgsql as $$
begin
  raise exception 'marketing_consent_events is append-only';
end $$;
create trigger marketing_consent_events_no_update before update on public.marketing_consent_events
  for each row execute function app.forbid_consent_event_update();

-- ---------------------------------------------------------- permissions
alter table public.marketing_subscriptions  enable row level security;
alter table public.marketing_consent_events enable row level security;
revoke all on public.marketing_subscriptions, public.marketing_consent_events from anon, authenticated;
revoke all on sequence public.marketing_consent_events_id_seq from anon, authenticated;

-- =====================================================================
-- Plans page extras: referrals, refund requests for unusable photos, and
-- support tickets.
--
-- Payments, orders, payment history and the credit audit trail already
-- exist (billing_orders, billing_payments, credit_grants, credit_ledger),
-- so nothing here duplicates them. Every credit these features give goes
-- through public.grant_credits with a unique key, so it can't be granted
-- twice.
--
-- All new tables are server only (RLS on, no policies, privileges revoked):
-- customers reach them through authenticated API routes scoped to their own
-- account, and admins through the admin API. Additive only.
-- =====================================================================

-- New credit sources: referral rewards and approved refund requests.
alter table public.credit_grants drop constraint if exists credit_grants_source_check;
alter table public.credit_grants add constraint credit_grants_source_check
  check (source in ('trial', 'plan', 'pack', 'admin', 'refund_restore', 'legacy', 'referral', 'refund_request'));

-- ------------------------------------------------------------ referrals
create table public.referral_codes (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at  timestamptz not null default now()
);

-- One row per invited account (a person can only ever be referred once).
create table public.referrals (
  id                     uuid primary key default gen_random_uuid(),
  referrer_user_id       uuid not null references public.profiles(id) on delete cascade,
  referee_user_id        uuid not null unique references public.profiles(id) on delete cascade,
  status                 text not null default 'pending' check (status in ('pending', 'rewarded', 'reversed')),
  qualifying_payment_id  uuid unique references public.billing_payments(id),
  referrer_grant_id      uuid references public.credit_grants(id),
  referee_grant_id       uuid references public.credit_grants(id),
  created_at             timestamptz not null default now(),
  rewarded_at            timestamptz,
  check (referrer_user_id <> referee_user_id),
  check (status = 'pending' or qualifying_payment_id is not null)
);
create index referrals_referrer_idx on public.referrals(referrer_user_id, created_at desc);

-- ------------------------------------------------------ refund requests
create table public.refund_requests (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id) on delete cascade,
  user_id           uuid not null references public.profiles(id),
  reason            text not null check (char_length(reason) between 10 and 1000),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  credits_requested integer not null check (credits_requested > 0),
  credits_returned  integer not null default 0 check (credits_returned >= 0),
  admin_note        text check (char_length(admin_note) <= 1000),
  decided_by        uuid references public.profiles(id),
  decided_at        timestamptz,
  grant_id          uuid references public.credit_grants(id),
  created_at        timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create index refund_requests_shop_idx on public.refund_requests(shop_id, created_at desc);
create index refund_requests_pending_idx on public.refund_requests(created_at) where status = 'pending';

-- Each photo can be in at most one request, ever: no double refunds.
create table public.refund_request_items (
  request_id          uuid not null references public.refund_requests(id) on delete cascade,
  generated_image_id  uuid not null unique references public.generated_images(id) on delete cascade,
  job_id              uuid not null references public.generation_jobs(id),
  credit_cost         integer not null check (credit_cost > 0),
  primary key (request_id, generated_image_id)
);

-- ------------------------------------------------------ support tickets
create table public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique check (reference ~ '^TKT-[A-Z0-9]{8}-[A-Z0-9]{4}$'),
  shop_id         uuid references public.shops(id) on delete set null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  subject         text not null check (char_length(subject) between 3 and 120),
  description     text not null check (char_length(description) between 10 and 4000),
  status          text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_response  text check (char_length(admin_response) <= 4000),
  responded_by    uuid references public.profiles(id),
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index support_tickets_open_idx on public.support_tickets(created_at) where status = 'open';

-- ---------------------------------------------------------- permissions
alter table public.referral_codes       enable row level security;
alter table public.referrals            enable row level security;
alter table public.refund_requests      enable row level security;
alter table public.refund_request_items enable row level security;
alter table public.support_tickets      enable row level security;
revoke all on public.referral_codes, public.referrals, public.refund_requests, public.refund_request_items, public.support_tickets
  from anon, authenticated;

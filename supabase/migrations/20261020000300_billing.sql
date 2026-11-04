-- =====================================================================
-- Billing: credit grants with expiry, Razorpay orders/subscriptions/
-- payments/refunds, webhook inbox, receipts.
--
-- Credits now come in "grants" (trial, plan month, pack, admin). Spending
-- takes from the grant that expires first; refunds put credits back where
-- they came from. credit_balances stays the fast cached total, and
-- credit_ledger stays the append-only history.
--
-- Every money-moving function is SECURITY DEFINER, idempotent on a unique
-- key, and executable only by the service role. Users can read their own
-- billing rows but can never write them.
-- =====================================================================

-- 'expiry' entries (added in 20261020000250) are always negative.
alter table public.credit_ledger drop constraint credit_ledger_check;
alter table public.credit_ledger add constraint credit_ledger_check check (
  (entry_type in ('debit', 'expiry') and amount < 0)
  or (entry_type in ('grant', 'refund') and amount > 0)
  or entry_type = 'adjustment');

-- ------------------------------------------------------------ settings
create table public.billing_settings (
  id                   boolean primary key default true check (id),
  trial_credits        integer not null default 10 check (trial_credits between 0 and 1000),
  trial_validity_days  integer not null default 30 check (trial_validity_days between 1 and 3650),
  updated_at           timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict do nothing;

-- ------------------------------------------------------ plans and packs
-- Mirrored from src/config/billing.ts by `npm run billing:sync`.
create table public.plans (
  id               text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name             text not null,
  monthly_credits  integer not null check (monthly_credits >= 0),
  limits           jsonb not null,
  is_paid          boolean not null,
  sort_order       integer not null default 0,
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);

create table public.plan_prices (
  id                uuid primary key default gen_random_uuid(),
  plan_id           text not null references public.plans(id),
  mode              text not null check (mode in ('test', 'live')),
  amount_paise      bigint not null check (amount_paise > 0),
  currency          text not null default 'INR' check (currency = 'INR'),
  razorpay_plan_id  text not null unique,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
-- At most one active price per plan per mode.
create unique index plan_prices_one_active on public.plan_prices(plan_id, mode) where active;

create table public.credit_packs (
  id             text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name           text not null,
  credits        integer not null check (credits > 0),
  amount_paise   bigint not null check (amount_paise > 0),
  validity_days  integer not null check (validity_days > 0),
  sort_order     integer not null default 0,
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------ billing
create table public.billing_subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  shop_id                   uuid not null references public.shops(id) on delete cascade,
  plan_id                   text not null references public.plans(id),
  price_id                  uuid not null references public.plan_prices(id),
  mode                      text not null check (mode in ('test', 'live')),
  razorpay_subscription_id  text not null unique,
  status                    text not null check (status in ('created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired')),
  current_start             timestamptz,
  current_end               timestamptz,
  cancel_at_cycle_end       boolean not null default false,
  scheduled_plan_id         text references public.plans(id),
  ended_at                  timestamptz,
  short_url                 text,
  last_event_at             timestamptz,
  created_by                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
-- One live subscription per shop. 'created' (checkout opened, never paid)
-- doesn't count, so an abandoned checkout can't block a new one.
create unique index billing_subscriptions_one_live on public.billing_subscriptions(shop_id)
  where status in ('authenticated', 'active', 'pending', 'halted', 'paused');
create index billing_subscriptions_shop_idx on public.billing_subscriptions(shop_id, created_at desc);

create table public.billing_orders (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id) on delete cascade,
  pack_id            text not null references public.credit_packs(id),
  credits            integer not null check (credits > 0),
  validity_days      integer not null check (validity_days > 0),
  amount_paise       bigint not null check (amount_paise > 0),
  currency           text not null default 'INR' check (currency = 'INR'),
  mode               text not null check (mode in ('test', 'live')),
  razorpay_order_id  text not null unique,
  status             text not null default 'created' check (status in ('created', 'paid')),
  idempotency_key    text not null,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (shop_id, idempotency_key)
);

create table public.billing_payments (
  id                     uuid primary key default gen_random_uuid(),
  shop_id                uuid not null references public.shops(id) on delete cascade,
  razorpay_payment_id    text not null unique,
  kind                   text not null check (kind in ('pack', 'subscription')),
  order_id               uuid references public.billing_orders(id),
  subscription_id        uuid references public.billing_subscriptions(id),
  amount_paise           bigint not null check (amount_paise > 0),
  currency               text not null default 'INR',
  status                 text not null check (status in ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  method                 text,                    -- e.g. card, upi, netbanking. No card numbers are ever stored.
  error_code             text,
  error_description      text,
  amount_refunded_paise  bigint not null default 0 check (amount_refunded_paise >= 0),
  credits_granted        integer not null default 0 check (credits_granted >= 0),
  grant_id               uuid,
  description            text not null,
  captured_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((kind = 'pack' and order_id is not null) or (kind = 'subscription' and subscription_id is not null))
);
create index billing_payments_shop_idx on public.billing_payments(shop_id, created_at desc);

create table public.billing_refunds (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.shops(id) on delete cascade,
  payment_id          uuid not null references public.billing_payments(id),
  razorpay_refund_id  text not null unique,
  amount_paise        bigint not null check (amount_paise > 0),
  status              text not null check (status in ('created', 'processed', 'failed')),
  credits_reversed    integer not null default 0,
  credits_shortfall   integer not null default 0,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);

create table public.billing_webhook_events (
  id                bigint generated always as identity primary key,
  event_id          text not null unique,
  event_type        text not null,
  mode              text not null check (mode in ('test', 'live')),
  payload           jsonb not null,
  event_created_at  timestamptz,
  received_at       timestamptz not null default now(),
  attempts          integer not null default 1,
  processed_at      timestamptz,
  outcome           text,
  last_error        text
);
create index billing_webhook_unprocessed_idx on public.billing_webhook_events(received_at) where processed_at is null;

create table public.billing_receipts (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  payment_id      uuid not null unique references public.billing_payments(id),
  receipt_number  text not null unique,
  issued_at       timestamptz not null default now(),
  buyer           jsonb not null   -- snapshot of business name / contact at issue time
);

create table public.receipt_counters (
  series  text primary key,
  last    integer not null default 0
);

-- ----------------------------------------------------- credit grants
create table public.credit_grants (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops(id) on delete cascade,
  source           text not null check (source in ('trial', 'plan', 'pack', 'admin', 'refund_restore', 'legacy')),
  amount           integer not null check (amount > 0),
  remaining        integer not null check (remaining >= 0 and remaining <= amount),
  expires_at       timestamptz,
  subscription_id  uuid references public.billing_subscriptions(id),
  payment_id       uuid references public.billing_payments(id),
  period_start     timestamptz,
  period_end       timestamptz,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);
create index credit_grants_spend_idx on public.credit_grants(shop_id, expires_at nulls last, created_at) where remaining > 0;

alter table public.billing_payments
  add constraint billing_payments_grant_fk foreign key (grant_id) references public.credit_grants(id);

-- Which grants each generation job's credits came from (for exact refunds).
create table public.credit_allocations (
  id        bigint generated always as identity primary key,
  job_id    uuid not null references public.generation_jobs(id) on delete cascade,
  grant_id  uuid not null references public.credit_grants(id),
  amount    integer not null check (amount > 0),
  unique (job_id, grant_id)
);

-- Existing balances become non-expiring legacy grants (already in the ledger).
insert into public.credit_grants (shop_id, source, amount, remaining, idempotency_key)
select shop_id, 'legacy', balance, balance, 'legacy:' || shop_id
  from public.credit_balances where balance > 0
on conflict (idempotency_key) do nothing;

-- ============================================================ functions

-- Expire a shop's lapsed grants. Caller must hold the credit_balances row lock.
create function app.expire_shop_grants(p_shop uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_balance int; n int := 0;
begin
  for r in select id, remaining from public.credit_grants
            where shop_id = p_shop and remaining > 0 and expires_at is not null and expires_at <= now()
            for update
  loop
    update public.credit_grants set remaining = 0 where id = r.id;
    update public.credit_balances set balance = balance - r.remaining, updated_at = now()
     where shop_id = p_shop returning balance into v_balance;
    insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, idempotency_key, reason)
    values (p_shop, 'expiry', -r.remaining, v_balance, 'expiry:grant:' || r.id, 'Credits expired');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Grant credits once per idempotency key. Returns the grant id, or null if this key was already used.
create function public.grant_credits(
  p_shop uuid, p_amount int, p_source text, p_expires_at timestamptz, p_key text, p_reason text,
  p_subscription uuid default null, p_payment uuid default null,
  p_period_start timestamptz default null, p_period_end timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_grant uuid; v_balance int;
begin
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform 1 from public.credit_balances where shop_id = p_shop for update;
  if not found then
    insert into public.credit_balances (shop_id, balance) values (p_shop, 0) on conflict do nothing;
    perform 1 from public.credit_balances where shop_id = p_shop for update;
  end if;

  insert into public.credit_grants (shop_id, source, amount, remaining, expires_at, subscription_id, payment_id,
                                    period_start, period_end, idempotency_key)
  values (p_shop, p_source, p_amount, p_amount, p_expires_at, p_subscription, p_payment, p_period_start, p_period_end, p_key)
  on conflict (idempotency_key) do nothing
  returning id into v_grant;
  if v_grant is null then return null; end if;

  update public.credit_balances set balance = balance + p_amount, updated_at = now()
   where shop_id = p_shop returning balance into v_balance;
  insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, idempotency_key, reason)
  values (p_shop, 'grant', p_amount, v_balance, p_key, p_reason);
  return v_grant;
end $$;

-- Take back up to p_credits from one grant (refunds). Idempotent on p_key.
-- Credits already spent can't be taken back; that part is returned as shortfall.
create function public.reverse_grant(p_grant uuid, p_credits int, p_key text, p_reason text)
returns table (r_reversed int, r_shortfall int)
language plpgsql security definer set search_path = '' as $$
declare v_g public.credit_grants%rowtype; v_take int; v_balance int;
begin
  if exists (select 1 from public.credit_ledger where idempotency_key = p_key) then
    return query select 0, 0; return;
  end if;
  select * into v_g from public.credit_grants where id = p_grant for update;
  if not found then raise exception 'grant_not_found'; end if;
  perform 1 from public.credit_balances where shop_id = v_g.shop_id for update;

  v_take := least(v_g.remaining, greatest(p_credits, 0));
  if v_take > 0 then
    update public.credit_grants set remaining = remaining - v_take where id = p_grant;
    update public.credit_balances set balance = balance - v_take, updated_at = now()
     where shop_id = v_g.shop_id returning balance into v_balance;
    insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, idempotency_key, reason)
    values (v_g.shop_id, 'adjustment', -v_take, v_balance, p_key, p_reason);
  end if;
  -- Callers record the outcome (billing_refunds) so a retry doesn't run again when nothing was taken.
  return query select v_take, greatest(p_credits, 0) - v_take;
end $$;

-- Sweep: expire lapsed grants for every shop (cron).
create function public.expire_credit_grants() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select distinct shop_id from public.credit_grants
            where remaining > 0 and expires_at is not null and expires_at <= now()
  loop
    perform 1 from public.credit_balances where shop_id = r.shop_id for update;
    n := n + app.expire_shop_grants(r.shop_id);
  end loop;
  return n;
end $$;

-- Atomic receipt numbers: <series>/<000001>, e.g. AS/2026-27/000001.
create function public.next_receipt_number(p_series text) returns text
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.receipt_counters (series, last) values (p_series, 1)
  on conflict (series) do update set last = public.receipt_counters.last + 1
  returning last into v;
  return p_series || '/' || lpad(v::text, 6, '0');
end $$;

-- ---------------------------------------------- generation: spend from grants
create or replace function public.create_generation_job(
  p_user uuid, p_shop uuid, p_source_image uuid, p_preset text, p_preset_version int,
  p_instructions text, p_credit_cost int, p_provider text, p_model text,
  p_idempotency_key text, p_max_active int, p_daily_limit int
) returns table (r_job_id uuid, r_replayed boolean, r_balance integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.generation_jobs%rowtype;
  v_balance  int;
  v_active   int;
  v_today    int;
  v_job      uuid;
  v_need     int;
  v_take     int;
  g          record;
begin
  select * into v_existing from public.generation_jobs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.shop_id <> p_shop then raise exception 'forbidden'; end if;
    select b.balance into v_balance from public.credit_balances b where b.shop_id = p_shop;
    return query select v_existing.id, true, coalesce(v_balance, 0);
    return;
  end if;

  if not exists (select 1 from public.shop_members
                 where shop_id = p_shop and user_id = p_user and role in ('owner', 'editor')) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.source_images where id = p_source_image and shop_id = p_shop) then
    raise exception 'source_not_found';
  end if;
  if not exists (select 1 from public.source_images where id = p_source_image and shop_id = p_shop and status = 'ready') then
    raise exception 'source_not_ready';
  end if;

  perform 1 from public.credit_balances b where b.shop_id = p_shop for update;
  if not found then raise exception 'forbidden'; end if;
  perform app.expire_shop_grants(p_shop);
  select b.balance into v_balance from public.credit_balances b where b.shop_id = p_shop;

  select count(*) into v_active from public.generation_jobs where shop_id = p_shop and status in ('queued', 'processing');
  if v_active >= p_max_active then raise exception 'too_many_active_jobs'; end if;
  select count(*) into v_today from public.generation_jobs where shop_id = p_shop and created_at > now() - interval '24 hours';
  if v_today >= p_daily_limit then raise exception 'daily_limit_reached'; end if;
  if v_balance < p_credit_cost then raise exception 'insufficient_credits:%', v_balance; end if;

  insert into public.generation_jobs (shop_id, source_image_id, requested_by, preset_slug, preset_version,
    instructions, credit_cost, provider, model, idempotency_key)
  values (p_shop, p_source_image, p_user, p_preset, p_preset_version, p_instructions, p_credit_cost, p_provider, p_model, p_idempotency_key)
  returning id into v_job;

  if p_credit_cost > 0 then
    -- Spend the credits that expire soonest first.
    v_need := p_credit_cost;
    for g in select id, remaining from public.credit_grants
              where shop_id = p_shop and remaining > 0 and (expires_at is null or expires_at > now())
              order by expires_at nulls last, created_at
              for update
    loop
      exit when v_need = 0;
      v_take := least(g.remaining, v_need);
      update public.credit_grants set remaining = remaining - v_take where id = g.id;
      insert into public.credit_allocations (job_id, grant_id, amount) values (v_job, g.id, v_take);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'credit_grants_out_of_sync'; end if;

    update public.credit_balances set balance = balance - p_credit_cost, updated_at = now()
     where shop_id = p_shop returning credit_balances.balance into v_balance;
    insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, job_id, idempotency_key, reason)
    values (p_shop, 'debit', -p_credit_cost, v_balance, v_job, 'debit:job:' || v_job, 'Generation ' || p_preset);
  end if;

  return query select v_job, false, v_balance;
exception when unique_violation then
  return query select g2.id, true, (select b.balance from public.credit_balances b where b.shop_id = p_shop)
    from public.generation_jobs g2 where g2.idempotency_key = p_idempotency_key;
end $$;

-- Refund returns each credit to the grant it came from; if that grant has
-- since expired, the credits come back as a fresh 30-day grant instead.
create or replace function public.fail_generation_job(p_job uuid, p_error_code text, p_error_message text, p_refund boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.generation_jobs%rowtype;
  v_balance int;
  a record;
  v_restore int := 0;
begin
  update public.generation_jobs
     set status = 'failed', finished_at = now(), locked_until = null,
         error_code = left(p_error_code, 60), error_message = left(p_error_message, 300)
   where id = p_job and status in ('queued', 'processing')
  returning * into v_job;
  if not found then return false; end if;

  if p_refund and v_job.credit_cost > 0
     and not exists (select 1 from public.credit_ledger where idempotency_key = 'refund:job:' || v_job.id) then
    perform 1 from public.credit_balances where shop_id = v_job.shop_id for update;
    for a in select ca.grant_id, ca.amount, cg.expires_at
               from public.credit_allocations ca join public.credit_grants cg on cg.id = ca.grant_id
              where ca.job_id = v_job.id
    loop
      if a.expires_at is null or a.expires_at > now() then
        update public.credit_grants set remaining = remaining + a.amount where id = a.grant_id;
      else
        v_restore := v_restore + a.amount;
      end if;
    end loop;
    if v_restore > 0 then
      insert into public.credit_grants (shop_id, source, amount, remaining, expires_at, idempotency_key)
      values (v_job.shop_id, 'refund_restore', v_restore, v_restore, now() + interval '30 days', 'restore:job:' || v_job.id);
    end if;
    update public.credit_balances set balance = balance + v_job.credit_cost, updated_at = now()
     where shop_id = v_job.shop_id returning balance into v_balance;
    insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, job_id, idempotency_key, reason)
    values (v_job.shop_id, 'refund', v_job.credit_cost, v_balance, v_job.id, 'refund:job:' || v_job.id, 'Failed generation');
    update public.generation_jobs set refunded = true where id = v_job.id;
  end if;
  return true;
end $$;

-- Sign-up: trial allowance from billing_settings, as an expiring grant.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_settings public.billing_settings%rowtype;
begin
  insert into public.profiles (id) values (new.id);
  insert into public.shops (name, created_by) values ('My shop', new.id) returning id into v_shop;
  insert into public.shop_members (shop_id, user_id, role) values (v_shop, new.id, 'owner');
  insert into public.credit_balances (shop_id, balance) values (v_shop, 0);
  select * into v_settings from public.billing_settings where id;
  if coalesce(v_settings.trial_credits, 0) > 0 then
    perform public.grant_credits(v_shop, v_settings.trial_credits, 'trial',
      now() + make_interval(days => v_settings.trial_validity_days), 'grant:trial:' || v_shop, 'Free trial');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------- permissions
revoke execute on function public.grant_credits(uuid, int, text, timestamptz, text, text, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.reverse_grant(uuid, int, text, text) from public, anon, authenticated;
revoke execute on function public.expire_credit_grants() from public, anon, authenticated;
revoke execute on function public.next_receipt_number(text) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, int, text, timestamptz, text, text, uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.reverse_grant(uuid, int, text, text) to service_role;
grant execute on function public.expire_credit_grants() to service_role;
grant execute on function public.next_receipt_number(text) to service_role;

-- Belt and braces: authenticated users can never write balances, grants or ledger rows directly.
revoke insert, update, delete, truncate on
  public.credit_balances, public.credit_ledger, public.credit_grants, public.credit_allocations,
  public.billing_settings, public.plans, public.plan_prices, public.credit_packs,
  public.billing_subscriptions, public.billing_orders, public.billing_payments, public.billing_refunds,
  public.billing_webhook_events, public.billing_receipts, public.receipt_counters
from anon, authenticated;
-- Server-only tables aren't readable by clients at all.
revoke select on public.billing_settings, public.plan_prices, public.billing_webhook_events, public.receipt_counters, public.credit_allocations
from anon, authenticated;
revoke execute on function app.expire_shop_grants(uuid) from public, anon, authenticated;

alter table public.billing_settings        enable row level security;
alter table public.plans                   enable row level security;
alter table public.plan_prices             enable row level security;
alter table public.credit_packs            enable row level security;
alter table public.billing_subscriptions   enable row level security;
alter table public.billing_orders          enable row level security;
alter table public.billing_payments        enable row level security;
alter table public.billing_refunds         enable row level security;
alter table public.billing_webhook_events  enable row level security;
alter table public.billing_receipts        enable row level security;
alter table public.receipt_counters        enable row level security;
alter table public.credit_grants           enable row level security;
alter table public.credit_allocations      enable row level security;

create policy plans_read on public.plans for select to authenticated using (active);
create policy credit_packs_read on public.credit_packs for select to authenticated using (active);
create policy billing_subscriptions_member on public.billing_subscriptions for select to authenticated using (app.is_shop_member(shop_id));
create policy billing_orders_member on public.billing_orders for select to authenticated using (app.is_shop_member(shop_id));
create policy billing_payments_member on public.billing_payments for select to authenticated using (app.is_shop_member(shop_id));
create policy billing_refunds_member on public.billing_refunds for select to authenticated using (app.is_shop_member(shop_id));
create policy billing_receipts_member on public.billing_receipts for select to authenticated using (app.is_shop_member(shop_id));
create policy credit_grants_member on public.credit_grants for select to authenticated using (app.is_shop_member(shop_id));
-- billing_settings, plan_prices, webhook events, receipt counters, allocations: server only.

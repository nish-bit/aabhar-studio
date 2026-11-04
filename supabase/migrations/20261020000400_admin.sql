-- =====================================================================
-- Admin: server-verified platform roles, append-only audit log, account
-- disabling, preset settings and plan overrides.
--
-- None of these tables are readable or writable by signed-in customers:
-- RLS is on with no policies, and table privileges are revoked. The admin
-- dashboard reads and writes them only from the server, after checking
-- platform_admins for the verified session user.
-- =====================================================================

-- ------------------------------------------------------- platform roles
-- 'admin'   : full read + write (grants, disables, plan/preset changes, retries)
-- 'support' : read-only
-- Granted only with scripts/admin-role.ts (direct database access). There is
-- deliberately no API to create admins.
create table public.platform_admins (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        text not null check (role in ('admin', 'support')),
  granted_by  text not null,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- -------------------------------------------------------- account status
alter table public.profiles
  add column disabled_at     timestamptz,
  add column disabled_reason text check (char_length(disabled_reason) <= 500),
  add column disabled_by     uuid references public.profiles(id);

-- ------------------------------------------------------------ audit log
create table public.admin_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid not null references public.profiles(id),
  actor_role   text not null,
  action       text not null check (action ~ '^[a-z_.]{3,60}$'),
  target_type  text not null check (target_type ~ '^[a-z_]{2,40}$'),
  target_id    text,
  reason       text check (char_length(reason) <= 500),
  details      jsonb not null default '{}'::jsonb,
  ip           text,
  user_agent   text check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log(target_type, target_id, created_at desc);

create function app.forbid_audit_change() returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;
create trigger admin_audit_log_append_only before update or delete on public.admin_audit_log
  for each row execute function app.forbid_audit_change();

-- ------------------------------------------------------ preset settings
-- Prompts stay in code (versioned and tested); admins can switch a preset
-- off for new generations and change its credit cost.
create table public.preset_settings (
  slug         text primary key check (slug in ('white-studio', 'warm-ivory', 'black-luxury', 'velvet', 'marble', 'editorial')),
  enabled      boolean not null default true,
  credit_cost  integer not null check (credit_cost between 1 and 10),
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now()
);

-- -------------------------------------------------------- plan overrides
-- When set, the database row (limits, monthly_credits) wins over
-- src/config/billing.ts, and billing:sync leaves it alone.
alter table public.plans
  add column overridden_at timestamptz,
  add column overridden_by uuid references public.profiles(id);

-- Indexes for admin search and filters.
create index generation_jobs_status_created_idx on public.generation_jobs(status, created_at desc);
create index generation_jobs_created_idx on public.generation_jobs(created_at desc);
create index billing_payments_created_idx on public.billing_payments(created_at desc);
create index credit_ledger_created_idx on public.credit_ledger(created_at desc);

-- ------------------------------------------------- job creation guard
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

  -- Disabled accounts can't start new work (enforced here as well as in the API layer).
  if exists (select 1 from public.profiles where id = p_user and disabled_at is not null) then
    raise exception 'account_disabled';
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


-- ---------------------------------------------------------- permissions
alter table public.platform_admins  enable row level security;
alter table public.admin_audit_log  enable row level security;
alter table public.preset_settings  enable row level security;
revoke all on public.platform_admins, public.admin_audit_log, public.preset_settings from anon, authenticated;
-- Customers can still read their own profile row (RLS), but never the moderation fields' writers.
revoke update on public.profiles from anon, authenticated;
-- Customers may read their own profile, but not who disabled them or the internal reason.
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, created_at, disabled_at) on public.profiles to authenticated;

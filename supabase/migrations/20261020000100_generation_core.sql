-- =====================================================================
-- Generation core: shops, credits, uploads, generation jobs, results.
-- Money and job state change only inside the SECURITY DEFINER functions
-- below, which only the service role may execute.
-- =====================================================================


create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- --------------------------------------------------------------- types
create type public.shop_role     as enum ('owner', 'editor', 'viewer');
create type public.upload_status as enum ('pending', 'ready', 'rejected');
create type public.job_status    as enum ('queued', 'processing', 'succeeded', 'failed');
create type public.review_status as enum ('pending', 'approved', 'discarded');
create type public.ledger_type   as enum ('grant', 'debit', 'refund', 'adjustment');

-- ------------------------------------------------------- identity/tenancy
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  created_at  timestamptz not null default now()
);

create table public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.shop_members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.shop_role not null,
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create unique index one_owner_per_shop on public.shop_members(shop_id) where role = 'owner';
create index shop_members_user_idx on public.shop_members(user_id);

-- ----------------------------------------------------------------- credits
create table public.credit_balances (
  shop_id     uuid primary key references public.shops(id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);

create table public.credit_ledger (
  id               bigint generated always as identity primary key,
  shop_id          uuid not null references public.shops(id) on delete cascade,
  entry_type       public.ledger_type not null,
  amount           integer not null check (amount <> 0),
  balance_after    integer not null check (balance_after >= 0),
  job_id           uuid,
  idempotency_key  text not null unique,
  reason           text,
  created_at       timestamptz not null default now(),
  check ((entry_type = 'debit' and amount < 0) or (entry_type in ('grant', 'refund') and amount > 0) or entry_type = 'adjustment')
);
create index credit_ledger_shop_idx on public.credit_ledger(shop_id, created_at desc);

-- Ledger rows are append-only.
create function app.forbid_ledger_change() returns trigger language plpgsql as $$
begin
  raise exception 'credit_ledger is append-only';
end $$;
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function app.forbid_ledger_change();

-- -------------------------------------------------------------- uploads
create table public.source_images (
  id                  uuid primary key,
  shop_id             uuid not null references public.shops(id) on delete cascade,
  uploaded_by         uuid not null references public.profiles(id),
  file_name           text not null check (char_length(file_name) between 1 and 255),
  declared_mime_type  text not null check (declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  declared_bytes      integer not null check (declared_bytes between 1 and 26214400),
  upload_path         text not null unique,
  storage_path        text unique,
  mime_type           text check (mime_type in ('image/jpeg', 'image/png')),
  bytes               integer,
  width               integer check (width between 800 and 12000),
  height              integer check (height between 800 and 12000),
  sha256              text,
  status              public.upload_status not null default 'pending',
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  check (status <> 'ready' or (storage_path is not null and width is not null and height is not null))
);
create index source_images_shop_idx on public.source_images(shop_id, created_at desc);
create index source_images_shop_sha_idx on public.source_images(shop_id, sha256);

-- ------------------------------------------------------------------ jobs
create table public.generation_jobs (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id) on delete cascade,
  source_image_id    uuid not null references public.source_images(id) on delete cascade,
  requested_by       uuid not null references public.profiles(id),
  preset_slug        text not null check (preset_slug in ('white-studio', 'warm-ivory', 'black-luxury', 'velvet', 'marble', 'editorial')),
  preset_version     integer not null check (preset_version > 0),
  instructions       text check (char_length(instructions) <= 400),
  credit_cost        integer not null check (credit_cost between 0 and 20),
  provider           text not null,
  model              text not null,
  status             public.job_status not null default 'queued',
  idempotency_key    text not null unique,
  locked_until       timestamptz,
  error_code         text,
  error_message      text,
  refunded           boolean not null default false,
  cost_usd_micros    bigint check (cost_usd_micros >= 0),
  usage              jsonb,
  provider_request_id text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz
);
create index generation_jobs_shop_idx on public.generation_jobs(shop_id, created_at desc);
create index generation_jobs_active_idx on public.generation_jobs(status, locked_until)
  where status in ('queued', 'processing');

create table public.job_attempts (
  id                   bigint generated always as identity primary key,
  job_id               uuid not null references public.generation_jobs(id) on delete cascade,
  attempt_no           smallint not null check (attempt_no between 1 and 10),
  provider             text not null,
  model                text not null,
  outcome              text not null check (outcome in ('succeeded', 'retryable_error', 'fatal_error', 'timeout')),
  error_code           text,
  provider_request_id  text,
  latency_ms           integer,
  usage                jsonb,
  cost_usd_micros      bigint check (cost_usd_micros >= 0),
  created_at           timestamptz not null default now(),
  unique (job_id, attempt_no)
);

create table public.generated_images (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  job_id         uuid not null unique references public.generation_jobs(id) on delete cascade,
  storage_path   text not null unique,
  mime_type      text not null,
  width          integer not null check (width > 0),
  height         integer not null check (height > 0),
  bytes          integer not null check (bytes > 0),
  review_status  public.review_status not null default 'pending',
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index generated_images_shop_idx on public.generated_images(shop_id, created_at desc);

-- ============================================================ helpers
create function app.is_shop_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shop_members where shop_id = p_shop and user_id = (select auth.uid()));
$$;
grant execute on function app.is_shop_member(uuid) to authenticated;

-- ======================================================= sign-up trigger
-- Every new user gets a profile, a shop they own, and 10 trial credits.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid;
begin
  insert into public.profiles (id) values (new.id);
  insert into public.shops (name, created_by) values ('My shop', new.id) returning id into v_shop;
  insert into public.shop_members (shop_id, user_id, role) values (v_shop, new.id, 'owner');
  insert into public.credit_balances (shop_id, balance) values (v_shop, 10);
  insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, idempotency_key, reason)
  values (v_shop, 'grant', 10, 10, 'grant:trial:' || v_shop, 'Free trial');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ================================================ money & job functions

-- Create a job and debit credits in one transaction.
-- Replays of the same idempotency key return the original job and charge nothing.
create function public.create_generation_job(
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
    raise exception 'source_not_found';  -- same answer whether it doesn't exist or belongs to another shop
  end if;
  if not exists (select 1 from public.source_images
                 where id = p_source_image and shop_id = p_shop and status = 'ready') then
    raise exception 'source_not_ready';
  end if;

  -- Serialise all spending for this shop.
  select b.balance into v_balance from public.credit_balances b where b.shop_id = p_shop for update;
  if not found then raise exception 'forbidden'; end if;

  select count(*) into v_active from public.generation_jobs
   where shop_id = p_shop and status in ('queued', 'processing');
  if v_active >= p_max_active then raise exception 'too_many_active_jobs'; end if;

  select count(*) into v_today from public.generation_jobs
   where shop_id = p_shop and created_at > now() - interval '24 hours';
  if v_today >= p_daily_limit then raise exception 'daily_limit_reached'; end if;

  if v_balance < p_credit_cost then raise exception 'insufficient_credits:%', v_balance; end if;

  insert into public.generation_jobs (shop_id, source_image_id, requested_by, preset_slug, preset_version,
    instructions, credit_cost, provider, model, idempotency_key)
  values (p_shop, p_source_image, p_user, p_preset, p_preset_version,
    p_instructions, p_credit_cost, p_provider, p_model, p_idempotency_key)
  returning id into v_job;

  if p_credit_cost > 0 then
    update public.credit_balances set balance = balance - p_credit_cost, updated_at = now()
     where shop_id = p_shop returning credit_balances.balance into v_balance;
    insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, job_id, idempotency_key, reason)
    values (p_shop, 'debit', -p_credit_cost, v_balance, v_job, 'debit:job:' || v_job, 'Generation ' || p_preset);
  end if;

  return query select v_job, false, v_balance;
exception when unique_violation then
  -- A concurrent request with the same key won the race.
  return query select g.id, true, (select b.balance from public.credit_balances b where b.shop_id = p_shop)
    from public.generation_jobs g where g.idempotency_key = p_idempotency_key;
end $$;

-- queued → processing, with a lease. Returns nothing if the job isn't queued.
create function public.claim_generation_job(p_job uuid, p_lease_seconds int)
returns setof public.generation_jobs
language sql security definer set search_path = '' as $$
  update public.generation_jobs
     set status = 'processing', started_at = now(), locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job and status = 'queued'
  returning *;
$$;

-- processing → succeeded, insert the result. False if the job is no longer processing.
create function public.complete_generation_job(
  p_job uuid, p_storage_path text, p_mime_type text, p_width int, p_height int, p_bytes int,
  p_usage jsonb, p_cost_usd_micros bigint, p_provider_request_id text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid;
begin
  update public.generation_jobs
     set status = 'succeeded', finished_at = now(), locked_until = null,
         usage = p_usage, cost_usd_micros = p_cost_usd_micros, provider_request_id = p_provider_request_id
   where id = p_job and status = 'processing'
  returning shop_id into v_shop;
  if not found then return false; end if;

  insert into public.generated_images (shop_id, job_id, storage_path, mime_type, width, height, bytes)
  values (v_shop, p_job, p_storage_path, p_mime_type, p_width, p_height, p_bytes);
  return true;
end $$;

-- queued|processing → failed, refunding at most once.
create function public.fail_generation_job(p_job uuid, p_error_code text, p_error_message text, p_refund boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.generation_jobs%rowtype;
  v_balance int;
begin
  update public.generation_jobs
     set status = 'failed', finished_at = now(), locked_until = null,
         error_code = left(p_error_code, 60), error_message = left(p_error_message, 300)
   where id = p_job and status in ('queued', 'processing')
  returning * into v_job;
  if not found then return false; end if;

  if p_refund and v_job.credit_cost > 0 then
    perform 1 from public.credit_balances where shop_id = v_job.shop_id for update;
    begin
      update public.credit_balances set balance = balance + v_job.credit_cost, updated_at = now()
       where shop_id = v_job.shop_id returning balance into v_balance;
      insert into public.credit_ledger (shop_id, entry_type, amount, balance_after, job_id, idempotency_key, reason)
      values (v_job.shop_id, 'refund', v_job.credit_cost, v_balance, v_job.id, 'refund:job:' || v_job.id, 'Failed generation');
      update public.generation_jobs set refunded = true where id = v_job.id;
    exception when unique_violation then
      null; -- already refunded; the balance update above is rolled back with this block
    end;
  end if;
  return true;
end $$;

-- Watchdog: fail and refund processing jobs whose lease expired.
create function public.expire_stale_generation_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.generation_jobs
            where status = 'processing' and locked_until < now()
            for update skip locked
  loop
    if public.fail_generation_job(r.id, 'timeout', 'The image service didn''t finish in time. Your credits were returned.', true) then
      n := n + 1;
    end if;
  end loop;
  -- Queued jobs that never started (e.g. the worker was lost before claiming).
  for r in select id from public.generation_jobs
            where status = 'queued' and created_at < now() - interval '10 minutes'
            for update skip locked
  loop
    if public.fail_generation_job(r.id, 'not_started', 'This generation didn''t start. Your credits were returned.', true) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function public.create_generation_job(uuid, uuid, uuid, text, int, text, int, text, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.claim_generation_job(uuid, int) from public, anon, authenticated;
revoke execute on function public.complete_generation_job(uuid, text, text, int, int, int, jsonb, bigint, text) from public, anon, authenticated;
revoke execute on function public.fail_generation_job(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.expire_stale_generation_jobs() from public, anon, authenticated;
grant execute on function public.create_generation_job(uuid, uuid, uuid, text, int, text, int, text, text, text, int, int) to service_role;
grant execute on function public.claim_generation_job(uuid, int) to service_role;
grant execute on function public.complete_generation_job(uuid, text, text, int, int, int, jsonb, bigint, text) to service_role;
grant execute on function public.fail_generation_job(uuid, text, text, boolean) to service_role;
grant execute on function public.expire_stale_generation_jobs() to service_role;

-- ================================================================== RLS
-- Read-only for members; every write goes through the server (service role).
alter table public.profiles         enable row level security;
alter table public.shops            enable row level security;
alter table public.shop_members     enable row level security;
alter table public.credit_balances  enable row level security;
alter table public.credit_ledger    enable row level security;
alter table public.source_images    enable row level security;
alter table public.generation_jobs  enable row level security;
alter table public.job_attempts     enable row level security;
alter table public.generated_images enable row level security;

create policy profiles_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy shops_member on public.shops for select to authenticated using (app.is_shop_member(id));
create policy shop_members_member on public.shop_members for select to authenticated using (app.is_shop_member(shop_id));
create policy credit_balances_member on public.credit_balances for select to authenticated using (app.is_shop_member(shop_id));
create policy credit_ledger_member on public.credit_ledger for select to authenticated using (app.is_shop_member(shop_id));
create policy source_images_member on public.source_images for select to authenticated using (app.is_shop_member(shop_id));
create policy generation_jobs_member on public.generation_jobs for select to authenticated using (app.is_shop_member(shop_id));
create policy generated_images_member on public.generated_images for select to authenticated using (app.is_shop_member(shop_id));
-- job_attempts: no client policy (internal cost and provider data).

-- ============================================================== storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('originals', 'originals', false, 26214400, array['image/jpeg', 'image/png', 'image/webp']),
  ('generated', 'generated', false, 41943040, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Members may read their shop's objects (paths start with the shop id).
-- No insert/update/delete policies: uploads use server-minted signed upload URLs.
create policy "members read own shop objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('originals', 'generated')
    and app.is_shop_member(((storage.foldername(name))[1])::uuid)
  );

-- Post-migration verification. Safe to run on production (read-only).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-database.sql
-- Fails (raises an error) on any problem; prints a summary otherwise.
do $$
declare
  v_missing_rls text;
  v_exposed_fns text;
  v_public_buckets text;
  v_tables int;
begin
  select string_agg(c.relname, ', ') into v_missing_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing_rls is not null then raise exception 'FAIL: RLS disabled on: %', v_missing_rls; end if;

  -- Customers (anon/authenticated) may execute only these functions.
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_exposed_fns
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and n.nspname || '.' || p.proname not in ('app.is_shop_member');
  if v_exposed_fns is not null then raise exception 'FAIL: functions callable by customers: %', v_exposed_fns; end if;

  select string_agg(id, ', ') into v_public_buckets from storage.buckets
   where id in ('originals', 'generated', 'brand-assets', 'catalogues') and public;
  if v_public_buckets is not null then raise exception 'FAIL: public buckets: %', v_public_buckets; end if;
  if (select count(*) from storage.buckets where id in ('originals', 'generated', 'brand-assets', 'catalogues')) <> 4 then
    raise exception 'FAIL: storage buckets missing';
  end if;

  if has_table_privilege('authenticated', 'public.credit_balances', 'update')
     or has_table_privilege('authenticated', 'public.credit_grants', 'insert')
     or has_table_privilege('authenticated', 'public.platform_admins', 'select') then
    raise exception 'FAIL: customers have write access to money or admin tables';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    raise exception 'FAIL: sign-up trigger missing';
  end if;

  select count(*) into v_tables from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
  raise notice 'PASS: % public tables with RLS; customer-callable functions limited; buckets private; sign-up trigger present.', v_tables;
end $$;

-- Informational
select (select count(*) from public.platform_admins where revoked_at is null and role = 'admin') as active_admins,
       (select trial_credits from public.billing_settings where id) as trial_credits,
       (select count(*) from public.plan_prices where active) as active_prices;

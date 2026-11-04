-- =====================================================================
-- Every user gets exactly one shop, even if their account predates the
-- sign-up trigger.
--
-- Accounts created in auth.users before app.handle_new_user existed never
-- got a profile, shop or membership, so every shop-scoped page refused
-- them ("You don't have access to this"). This adds one idempotent
-- function that the trigger, a one-off backfill and the sign-in callback
-- all use:
--
--   public.ensure_user_shop(user) — if the user already belongs to a shop,
--   returns it and changes nothing; otherwise creates their profile, a shop
--   they own, a zero balance and the configured trial grant (keyed per shop,
--   so it can't be granted twice). A per-user advisory lock stops two
--   concurrent calls from creating two shops.
--
-- Additive: existing shops, memberships, balances and ledger rows are not
-- touched. Server only (revoked from anon/authenticated, like grant_credits).
-- =====================================================================

create or replace function public.ensure_user_shop(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_settings public.billing_settings%rowtype;
begin
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ensure_user_shop:' || p_user::text, 0));

  select m.shop_id into v_shop from public.shop_members m where m.user_id = p_user order by m.created_at limit 1;
  if v_shop is not null then
    return v_shop;
  end if;

  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  insert into public.shops (name, created_by) values ('My shop', p_user) returning id into v_shop;
  insert into public.shop_members (shop_id, user_id, role) values (v_shop, p_user, 'owner');
  insert into public.credit_balances (shop_id, balance) values (v_shop, 0) on conflict do nothing;

  select * into v_settings from public.billing_settings where id;
  if coalesce(v_settings.trial_credits, 0) > 0 then
    perform public.grant_credits(v_shop, v_settings.trial_credits, 'trial',
      now() + make_interval(days => v_settings.trial_validity_days), 'grant:trial:' || v_shop, 'Free trial');
  end if;
  return v_shop;
end $$;

revoke execute on function public.ensure_user_shop(uuid) from public, anon, authenticated;
grant execute on function public.ensure_user_shop(uuid) to service_role;

-- The sign-up trigger now uses the same function (same result for new users).
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_user_shop(new.id);
  return new;
end $$;

-- One-off backfill: users who signed up before the trigger existed.
do $$
declare u record;
begin
  for u in
    select au.id from auth.users au
     where not exists (select 1 from public.shop_members m where m.user_id = au.id)
  loop
    perform public.ensure_user_shop(u.id);
  end loop;
end $$;

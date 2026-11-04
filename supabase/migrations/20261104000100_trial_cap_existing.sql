-- Free trial limited to 2 generations for existing accounts too (requested 4 Nov 2026).
-- 20261103000500 changed only new sign-ups; accounts from the 10/7/3-credit
-- trials kept their larger allowance. Here every trial grant keeps at most
-- (2 − credits already used), never below zero:
--   used 0 → 2 left · used 1 → 1 left · used 2 or more → 0 left.
-- Nobody gains credits: a grant that already has fewer left is not touched.
-- Only trial grants change. Purchased, referral and admin credits, payments,
-- generation history and existing ledger rows stay as they are.
-- The removal goes through public.reverse_grant, so it is an ordinary
-- 'adjustment' ledger entry and the balance stays equal to the sum of the
-- grants. The per-grant idempotency key means running it again removes
-- nothing more. A generation still in progress that later fails returns its
-- credit as usual, because a failed image never counts as used.
do $$
declare
  c_cap constant int := 2;
  r record;
begin
  for r in
    select id, remaining - greatest(0, c_cap - (amount - remaining)) as excess
      from public.credit_grants
     where source = 'trial'
       and remaining > greatest(0, c_cap - (amount - remaining))
     order by created_at
  loop
    perform public.reverse_grant(r.id, r.excess, 'trial-cap:' || c_cap || ':' || r.id,
      'Free trial limited to ' || c_cap || ' generations');
  end loop;
end $$;

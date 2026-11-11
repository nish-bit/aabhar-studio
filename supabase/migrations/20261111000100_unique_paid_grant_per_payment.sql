-- At most one paid credit grant per payment, enforced by PostgreSQL.
--
-- Paid grants were already credited exactly once because the application gives
-- each one a deterministic idempotency key (grant:order:<razorpay order id> for
-- packs, grant:subpay:<razorpay payment id> for plan renewals) and
-- credit_grants.idempotency_key is UNIQUE. This index adds the same guarantee
-- at the database level independently of the key: if any code path ever tried
-- to grant the same payment again under a different key, the insert fails with
-- unique_violation and its whole transaction (payment update, grant, order
-- status) rolls back, instead of adding credits twice.
--
-- Scope: only rows that reference a payment AND are paid grants
-- (source 'pack' or 'plan'). Grants that never reference a payment are outside
-- the index by construction: trial (free sign-up), admin (promotional),
-- referral, legacy, refund_restore and refund_request. Refund reversals don't
-- insert grants (reverse_grant updates the original grant and the ledger).
--
-- Additive: creates an index only; no row is inserted, updated or deleted.
-- Safe for existing data: checked read-only on 2026-11-11, production had no
-- grants with a payment_id (3 grants, all 'trial') and no duplicates. If this
-- is applied to a database with paid grants, it fails (rather than altering
-- anything) should a duplicate exist; find them with:
--   select payment_id, count(*) from public.credit_grants
--    where payment_id is not null and source in ('pack', 'plan')
--    group by payment_id having count(*) > 1;
--
-- Rollback: drop index if exists public.credit_grants_one_paid_grant_per_payment;

create unique index if not exists credit_grants_one_paid_grant_per_payment
  on public.credit_grants (payment_id)
  where payment_id is not null and source in ('pack', 'plan');

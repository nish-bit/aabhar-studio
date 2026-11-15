-- One row per run of the billing reconciliation cron (/api/cron/billing, hourly),
-- so the admin billing health view can show when it last ran and how it went.
--
-- Additive: creates one table and one index; no existing row is read or changed.
-- Server-only, like billing_webhook_events: RLS on with no policies, and no
-- table privileges for client roles. reconcileBilling() keeps 90 days.
-- Until this is applied, reconciliation still runs; recording the run fails
-- softly (logged as billing.reconcile_run_not_recorded) and the health view
-- reports the run history as unavailable.
--
-- Rollback: drop table if exists public.billing_reconcile_runs;

create table if not exists public.billing_reconcile_runs (
  id                bigint generated always as identity primary key,
  started_at        timestamptz not null,
  finished_at       timestamptz not null default now(),
  ok                boolean not null,
  expired_grants    integer not null default 0 check (expired_grants >= 0),
  orders_checked    integer not null default 0 check (orders_checked >= 0),
  orders_confirmed  integer not null default 0 check (orders_confirmed >= 0),
  orders_failed     integer not null default 0 check (orders_failed >= 0),
  error             text check (error is null or length(error) <= 500)
);

create index if not exists billing_reconcile_runs_finished_idx on public.billing_reconcile_runs (finished_at desc);

alter table public.billing_reconcile_runs enable row level security;
revoke all on public.billing_reconcile_runs from anon, authenticated;

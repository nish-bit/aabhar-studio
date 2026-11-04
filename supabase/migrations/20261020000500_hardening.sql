-- =====================================================================
-- Pre-launch hardening: rate limits for expensive endpoints, tracked
-- preview files (so they can be expired), and retention support.
-- =====================================================================

-- ------------------------------------------------------- rate limiting
-- Fixed-window counters, incremented atomically. Server-only.
create table public.rate_limit_counters (
  key           text not null check (char_length(key) <= 200),
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- Returns true when the call is within the limit (and counts it).
create function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limit_counters (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke execute on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;

-- ------------------------------------------------ previews are tracked
-- Large previews are stored temporarily; tracking them lets retention delete them.
alter table public.catalogue_exports drop constraint catalogue_exports_kind_check;
alter table public.catalogue_exports add constraint catalogue_exports_kind_check check (kind in ('pdf', 'images_zip', 'preview'));

-- Indexes used by the retention job.
create index source_images_pending_idx on public.source_images(created_at) where status in ('pending', 'rejected');
create index generated_images_discarded_idx on public.generated_images(reviewed_at) where review_status = 'discarded';
create index catalogue_exports_created_idx on public.catalogue_exports(created_at);
create index billing_webhook_events_received_idx on public.billing_webhook_events(received_at);

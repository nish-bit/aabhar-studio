-- =====================================================================
-- Catalogues: business profile, catalogues, catalogue items, exports.
-- All product text is supplied by the shop; nothing is generated here.
-- The app writes through the server (service role / direct connection)
-- after checking membership; RLS gives members read access only.
-- =====================================================================

create type public.catalogue_layout      as enum ('grid', 'editorial');
create type public.catalogue_orientation as enum ('portrait', 'landscape');

-- --------------------------------------------------- business profile
create table public.business_profiles (
  shop_id        uuid primary key references public.shops(id) on delete cascade,
  business_name  text not null default '' check (char_length(business_name) <= 120),
  logo_path      text,
  logo_mime_type text check (logo_mime_type in ('image/png', 'image/jpeg')),
  phone          text not null default '' check (char_length(phone) <= 40),
  whatsapp       text not null default '' check (char_length(whatsapp) <= 40),
  email          text not null default '' check (char_length(email) <= 200),
  website        text not null default '' check (char_length(website) <= 200),
  address        text not null default '' check (char_length(address) <= 500),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------- catalogues
create table public.catalogues (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shops(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 120),
  layout                public.catalogue_layout not null default 'grid',
  orientation           public.catalogue_orientation not null default 'portrait',
  cover_title           text not null default '' check (char_length(cover_title) <= 120),
  cover_subtitle        text not null default '' check (char_length(cover_subtitle) <= 200),
  show_prices           boolean not null default false,
  -- Shown instead of a price when prices are on but an item has none (shop's own wording).
  price_note            text not null default '' check (char_length(price_note) <= 60),
  include_cover         boolean not null default true,
  include_contact_page  boolean not null default true,
  version               integer not null default 1 check (version > 0),
  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index catalogues_shop_idx on public.catalogues(shop_id, updated_at desc) where deleted_at is null;
create index catalogues_shop_deleted_idx on public.catalogues(shop_id, deleted_at desc) where deleted_at is not null;

create table public.catalogue_items (
  id                  uuid primary key default gen_random_uuid(),
  catalogue_id        uuid not null references public.catalogues(id) on delete cascade,
  shop_id             uuid not null references public.shops(id) on delete cascade,
  -- Set null if the image is removed; the PDF then shows "Image unavailable".
  generated_image_id  uuid references public.generated_images(id) on delete set null,
  position            integer not null check (position >= 0),
  name                text not null default '' check (char_length(name) <= 120),
  sku                 text not null default '' check (char_length(sku) <= 60),
  description         text not null default '' check (char_length(description) <= 2000),
  price_paise         bigint check (price_paise >= 0 and price_paise <= 100000000000),
  specs               jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) <= 12),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint catalogue_items_position_uniq unique (catalogue_id, position) deferrable initially deferred
);
create unique index catalogue_items_image_uniq on public.catalogue_items(catalogue_id, generated_image_id)
  where generated_image_id is not null;
create index catalogue_items_catalogue_idx on public.catalogue_items(catalogue_id, position);

create table public.catalogue_exports (
  id                 uuid primary key default gen_random_uuid(),
  catalogue_id       uuid not null references public.catalogues(id) on delete cascade,
  shop_id            uuid not null references public.shops(id) on delete cascade,
  kind               text not null check (kind in ('pdf', 'images_zip')),
  storage_path       text not null unique,
  bytes              integer not null check (bytes > 0),
  page_count         integer check (page_count > 0),
  catalogue_version  integer not null,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now()
);
create index catalogue_exports_catalogue_idx on public.catalogue_exports(catalogue_id, created_at desc);

-- ----------------------------------------------------------------- RLS
alter table public.business_profiles  enable row level security;
alter table public.catalogues         enable row level security;
alter table public.catalogue_items    enable row level security;
alter table public.catalogue_exports  enable row level security;

create policy business_profiles_member on public.business_profiles for select to authenticated using (app.is_shop_member(shop_id));
create policy catalogues_member on public.catalogues for select to authenticated using (app.is_shop_member(shop_id));
create policy catalogue_items_member on public.catalogue_items for select to authenticated using (app.is_shop_member(shop_id));
create policy catalogue_exports_member on public.catalogue_exports for select to authenticated using (app.is_shop_member(shop_id));

-- Existing shops get an empty profile; new shops get one from the sign-up trigger.
insert into public.business_profiles (shop_id) select id from public.shops on conflict do nothing;

create or replace function app.handle_new_shop_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_profiles (shop_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_shop_created_profile after insert on public.shops
  for each row execute function app.handle_new_shop_profile();

-- ------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('brand-assets', 'brand-assets', false, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('catalogues', 'catalogues', false, 157286400, array['application/pdf', 'application/zip'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members read own shop objects" on storage.objects;
create policy "members read own shop objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('originals', 'generated', 'brand-assets', 'catalogues')
    and app.is_shop_member(((storage.foldername(name))[1])::uuid)
  );

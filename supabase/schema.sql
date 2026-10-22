-- =====================================================================
-- ParkEats database schema
-- Run once in a NEW Supabase project: Dashboard -> SQL Editor -> paste -> Run
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- True for any signed-in user. Visitors who aren't signed in can't see anything.
create or replace function public.is_member()
returns boolean
language sql stable
set search_path = ''
as $$
  select auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select public.is_member() and exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  );
$$;

create table public.food_types (
  id         serial primary key,
  name       text not null unique check (char_length(name) between 1 and 40),
  icon       text not null default '🍽️',
  sort_order int  not null default 100
);

insert into public.food_types (name, icon, sort_order) values
  ('American',          '🍔', 10),
  ('BBQ',               '🍖', 20),
  ('Mexican',           '🌮', 30),
  ('Italian / Pizza',   '🍕', 40),
  ('Seafood',           '🦞', 50),
  ('Asian',             '🍜', 60),
  ('Mediterranean',     '🥙', 70),
  ('Breakfast / Brunch','🥞', 80),
  ('Coffee / Bakery',   '☕', 90),
  ('Sandwiches / Deli', '🥪', 100),
  ('Brewery / Pub',     '🍺', 110),
  ('Winery',            '🍷', 120),
  ('Vegetarian',        '🥗', 130),
  ('Dessert / Ice Cream','🍦', 140),
  ('Other',             '🍽️', 999);

create table public.parks (
  id        serial primary key,
  unit_name text not null,
  unit_nbr  text,
  subtype   text,
  geom      geography(MultiPolygon, 4326) not null
);
create index parks_geom_idx on public.parks using gist (geom);

create table public.restaurants (
  id               bigint generated always as identity primary key,
  created_by       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  address          text check (char_length(address) <= 300),
  food_type_id     int  not null references public.food_types (id),
  location         geography(Point, 4326) not null,
  recommended_item text check (char_length(recommended_item) <= 200),
  comment          text check (char_length(comment) <= 2000),
  photo_path       text,
  nearest_park_id  int references public.parks (id) on delete set null,
  park_distance_mi numeric(4,1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index restaurants_location_idx on public.restaurants using gist (location);
create index restaurants_created_by_idx on public.restaurants (created_by);

create table public.votes (
  restaurant_id bigint   not null references public.restaurants (id) on delete cascade,
  user_id       uuid     not null default auth.uid() references public.profiles (id) on delete cascade,
  value         smallint not null check (value in (-1, 1)),
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index votes_user_idx on public.votes (user_id);

create table public.comments (
  id            bigint generated always as identity primary key,
  restaurant_id bigint not null references public.restaurants (id) on delete cascade,
  user_id       uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  body          text   not null check (char_length(body) between 1 and 1000),
  created_at    timestamptz not null default now()
);
create index comments_restaurant_idx on public.comments (restaurant_id);

create table public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.flags (
  id          bigint generated always as identity primary key,
  target_type text   not null check (target_type in ('restaurant', 'comment')),
  target_id   bigint not null,
  reporter_id uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  reason      text   check (char_length(reason) <= 500),
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

-- ---------------------------------------------------------------------
-- Signup: auto-create a profile for each new account
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  split_part(new.email, '@', 1)), 60));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Park proximity: nearest park within 20 miles (32,186.88 m)
-- ---------------------------------------------------------------------

create or replace function public.nearest_park(p_lat float8, p_lng float8)
returns table (park_id int, unit_name text, distance_mi numeric)
language sql stable
security definer
set search_path = public, extensions
as $$
  select p.id, p.unit_name, round((st_distance(p.geom, pt.g) / 1609.344)::numeric, 1)
  from public.parks p,
       (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g) pt
  where st_dwithin(p.geom, pt.g, 32186.88)
  order by st_distance(p.geom, pt.g)
  limit 1;
$$;

create or replace function public.restaurants_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  np record;
begin
  select * into np
  from public.nearest_park(st_y(new.location::geometry), st_x(new.location::geometry));

  if not found then
    raise exception 'Restaurants must be within 20 miles of a California State Park.'
      using errcode = 'P0001';
  end if;

  new.nearest_park_id  := np.park_id;
  new.park_distance_mi := np.distance_mi;

  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger restaurants_before_write
  before insert or update on public.restaurants
  for each row execute function public.restaurants_before_write();

-- Pins within 100 m with a similar name (duplicate warning).
create or replace function public.find_nearby_duplicates(
  p_lat float8, p_lng float8, p_name text, p_exclude_id bigint default null)
returns table (id bigint, name text, distance_m int)
language sql stable
set search_path = public, extensions
as $$
  select r.id, r.name,
         st_distance(r.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)::int
  from public.restaurants r
  where st_dwithin(r.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 100)
    and similarity(lower(r.name), lower(p_name)) > 0.3
    and (p_exclude_id is null or r.id <> p_exclude_id)
  order by 3
  limit 5;
$$;

-- One-time loader used by scripts/load-parks.mjs (service role only).
create or replace function public.load_parks(features jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n int;
begin
  insert into public.parks (unit_name, unit_nbr, subtype, geom)
  select f -> 'properties' ->> 'UNITNAME',
         f -> 'properties' ->> 'UNITNBR',
         f -> 'properties' ->> 'SUBTYPE',
         st_multi(st_collectionextract(st_makevalid(
           st_setsrid(st_geomfromgeojson((f -> 'geometry')::text), 4326)), 3))::geography
  from jsonb_array_elements(features) f;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.load_parks(jsonb) from public, anon, authenticated;
grant execute on function public.load_parks(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Map view: one row per restaurant with vote/comment stats
-- ---------------------------------------------------------------------

create view public.restaurants_with_stats
with (security_invoker = true) as
select
  r.id,
  r.created_by,
  pr.display_name                   as submitted_by_name,
  r.name,
  r.address,
  r.food_type_id,
  ft.name                           as food_type,
  ft.icon                           as food_icon,
  st_y(r.location::geometry)        as lat,
  st_x(r.location::geometry)        as lng,
  r.recommended_item,
  r.comment,
  r.photo_path,
  r.nearest_park_id,
  pk.unit_name                      as park_name,
  r.park_distance_mi,
  r.created_at,
  r.updated_at,
  coalesce(v.ups, 0)::int           as ups,
  coalesce(v.downs, 0)::int         as downs,
  case when coalesce(v.ups, 0) + coalesce(v.downs, 0) = 0 then null
       else round(100.0 * v.ups / (v.ups + v.downs))::int end as pct_up,
  coalesce(c.n, 0)::int             as comment_count
from public.restaurants r
join public.profiles   pr on pr.id = r.created_by
join public.food_types ft on ft.id = r.food_type_id
left join public.parks pk on pk.id = r.nearest_park_id
left join (
  select restaurant_id,
         count(*) filter (where value = 1)  as ups,
         count(*) filter (where value = -1) as downs
  from public.votes group by restaurant_id
) v on v.restaurant_id = r.id
left join (
  select restaurant_id, count(*) as n from public.comments group by restaurant_id
) c on c.restaurant_id = r.id;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.food_types  enable row level security;
alter table public.parks       enable row level security;
alter table public.restaurants enable row level security;
alter table public.votes       enable row level security;
alter table public.comments    enable row level security;
alter table public.follows     enable row level security;
alter table public.flags       enable row level security;

-- profiles: members see names (not emails); users may only change their display name
revoke select on public.profiles from authenticated, anon;
grant select (id, display_name, is_admin, created_at) on public.profiles to authenticated;
create policy "profiles read"   on public.profiles for select to authenticated using (public.is_member());
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

-- food types: read all, admins manage
create policy "food_types read"  on public.food_types for select to authenticated using (public.is_member());
create policy "food_types admin" on public.food_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- parks: read only
create policy "parks read" on public.parks for select to authenticated using (public.is_member());

-- restaurants: owners write their own, admins any
create policy "restaurants read"   on public.restaurants for select to authenticated using (public.is_member());
create policy "restaurants insert" on public.restaurants for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
create policy "restaurants update" on public.restaurants for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "restaurants delete" on public.restaurants for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- votes: one per user per restaurant, not on your own restaurant
create policy "votes read"   on public.votes for select to authenticated using (public.is_member());
create policy "votes insert" on public.votes for insert to authenticated
  with check (
    public.is_member() and user_id = auth.uid()
    and not exists (select 1 from public.restaurants r
                    where r.id = votes.restaurant_id and r.created_by = auth.uid()));
create policy "votes update" on public.votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "votes delete" on public.votes for delete to authenticated
  using (user_id = auth.uid());

-- comments
create policy "comments read"   on public.comments for select to authenticated using (public.is_member());
create policy "comments insert" on public.comments for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
create policy "comments update" on public.comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "comments delete" on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- follows
create policy "follows read"   on public.follows for select to authenticated using (public.is_member());
create policy "follows insert" on public.follows for insert to authenticated
  with check (public.is_member() and follower_id = auth.uid());
create policy "follows delete" on public.follows for delete to authenticated
  using (follower_id = auth.uid());

-- flags: anyone can report; reporters see their own; admins see/resolve all
create policy "flags insert" on public.flags for insert to authenticated
  with check (public.is_member() and reporter_id = auth.uid());
create policy "flags read"   on public.flags for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
create policy "flags update" on public.flags for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "flags delete" on public.flags for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Photo storage (private bucket, 5 MB max, images only)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member());
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

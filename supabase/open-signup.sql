-- =====================================================================
-- ONLY needed if you already ran an older schema.sql that limited sign-up
-- to @parks.ca.gov. A fresh install of schema.sql already includes this.
--
-- Before running: Dashboard -> Authentication -> Hooks -> delete the
-- "Before User Created" hook if you added one.
-- =====================================================================

-- Any signed-in user is a member (policies call this function).
create or replace function public.is_staff()
returns boolean
language sql stable
set search_path = ''
as $$
  select auth.uid() is not null;
$$;

-- Use the display name chosen at sign-up.
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

-- Hide email addresses from other users.
revoke select on public.profiles from authenticated, anon;
grant select (id, display_name, is_admin, created_at) on public.profiles to authenticated;

drop function if exists public.hook_restrict_signup_domain(jsonb);

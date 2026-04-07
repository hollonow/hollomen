-- ─────────────────────────────────────────────────────────────────
-- HolloEngine: User Profiles Table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────

-- 1. Profiles table (extends auth.users)
create table if not exists public.profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  email      text not null,
  full_name  text,
  role       text not null default 'viewer' check (role in ('admin', 'viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 2. Row Level Security
alter table public.profiles enable row level security;

-- Authenticated users can read all profiles (needed for role checks)
create policy "Authenticated users can view profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Only admins can insert new profiles (invite flow)
create policy "Admins can insert profiles"
  on public.profiles for insert
  with check (
    auth.uid() in (select id from public.profiles where role = 'admin')
  );

-- Only admins can update profiles (change roles)
create policy "Admins can update profiles"
  on public.profiles for update
  using (
    auth.uid() in (select id from public.profiles where role = 'admin')
  );

-- Only admins can delete profiles
create policy "Admins can delete profiles"
  on public.profiles for delete
  using (
    auth.uid() in (select id from public.profiles where role = 'admin')
  );

-- 3. Auto-create profile when a new user signs up / is invited
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────
-- AFTER RUNNING THIS SQL:
-- 1. Create your admin account via Supabase Auth → Users → Invite user
-- 2. Then manually set their role to 'admin' by running:
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';
-- 3. Add NEXT_PUBLIC_SUPABASE_ANON_KEY to ui/.env.local
--    (find it in Supabase Dashboard → Settings → API → anon/public key)
-- ─────────────────────────────────────────────────────────────────

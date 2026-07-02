-- ============================================================================
-- RepoHosting: auth profiles + connector credentials
-- ============================================================================
-- Tables are namespaced clearly (profiles, connector_credentials) so they do
-- not collide with other tenants of this shared Supabase project.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles : one row per authenticated user, mirrored from auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'RepoHosting user profiles, mirrored from auth.users';

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- connector_credentials : per-user, per-provider tokens / API keys
-- ---------------------------------------------------------------------------
-- Vercel & Netlify -> OAuth access (+ optional refresh) tokens.
-- Render          -> personal API key (stored in access_token).
--
-- Secret columns (access_token, refresh_token) are NEVER granted to the
-- client `authenticated` role; only the service role (used by edge functions)
-- can read/write them. Clients may read the non-secret status columns of their
-- own rows so the UI can show "Connected".
-- ---------------------------------------------------------------------------
create table if not exists public.connector_credentials (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  provider               text not null check (provider in ('vercel', 'render', 'netlify')),
  access_token           text not null,
  refresh_token          text,
  token_type             text,
  scope                  text,
  external_account_id    text,
  external_account_name  text,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, provider)
);

comment on table public.connector_credentials is 'Third-party platform tokens/API keys, one row per (user, provider)';

create index if not exists connector_credentials_user_idx
  on public.connector_credentials (user_id);

alter table public.connector_credentials enable row level security;

-- Row visibility: users can see only their own connector rows.
drop policy if exists "connectors: read own" on public.connector_credentials;
create policy "connectors: read own"
  on public.connector_credentials for select
  using (auth.uid() = user_id);

-- Writes are performed exclusively by edge functions via the service role
-- (which bypasses RLS), so no INSERT/UPDATE/DELETE policies are granted to
-- clients on purpose.

-- Column-level privileges: hide secret material from the client role even for
-- rows the user is allowed to see.
revoke all on public.connector_credentials from anon, authenticated;
grant select
  (id, user_id, provider, external_account_id, external_account_name,
   metadata, created_at, updated_at)
  on public.connector_credentials to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists connectors_set_updated_at on public.connector_credentials;
create trigger connectors_set_updated_at
  before update on public.connector_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Mirror new auth users into profiles automatically
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update set
    email      = excluded.email,
    full_name  = excluded.full_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

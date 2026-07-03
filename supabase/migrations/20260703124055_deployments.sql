-- ============================================================================
-- deployments : one row per deploy triggered through RepoHosting
-- ============================================================================
create table if not exists public.deployments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  provider             text not null check (provider in ('vercel', 'render', 'netlify')),
  repo_url             text not null,
  repo_name            text not null,
  branch               text not null default 'main',
  root_dir             text,
  start_command        text,
  -- environment variables sent to the platform; may contain secrets, so this
  -- column is NOT granted to the client role (see below).
  env                  jsonb not null default '{}'::jsonb,
  status               text not null default 'deploying'
                         check (status in ('queued', 'deploying', 'success', 'failed', 'canceled')),
  external_id          text,          -- platform deployment/service id
  external_url         text,          -- link to the deployment page on the platform
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.deployments is 'Deployments triggered via RepoHosting, one row each';

create index if not exists deployments_user_created_idx
  on public.deployments (user_id, created_at desc);

alter table public.deployments enable row level security;

-- Users can read only their own deployments.
drop policy if exists "deployments: read own" on public.deployments;
create policy "deployments: read own"
  on public.deployments for select
  using (auth.uid() = user_id);

-- Writes happen exclusively through edge functions (service role bypasses RLS).
revoke all on public.deployments from anon, authenticated;
grant select
  (id, user_id, provider, repo_url, repo_name, branch, root_dir, start_command,
   status, external_id, external_url, error, created_at, updated_at)
  on public.deployments to authenticated;             -- note: `env` intentionally excluded
grant select, insert, update, delete on public.deployments to service_role;

drop trigger if exists deployments_set_updated_at on public.deployments;
create trigger deployments_set_updated_at
  before update on public.deployments
  for each row execute function public.set_updated_at();

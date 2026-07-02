-- ============================================================================
-- oauth_states : short-lived CSRF/state tokens for the OAuth connector flow
-- ============================================================================
-- The provider redirect (oauth-callback) arrives with no user JWT, so we can't
-- read auth.uid() there. oauth-start records a random `state` bound to the
-- authenticated user + provider; oauth-callback looks it up to know who to
-- attach the resulting token to. Rows are single-use and time-limited.
-- ============================================================================
create table if not exists public.oauth_states (
  state       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  provider    text not null check (provider in ('vercel', 'netlify')),
  redirect_to text,
  created_at  timestamptz not null default now()
);

comment on table public.oauth_states is 'Single-use OAuth state tokens binding a connect flow to a user';

create index if not exists oauth_states_created_idx on public.oauth_states (created_at);

-- Server-only table: RLS on, no client policies. Edge functions use the
-- service role (which bypasses RLS) exclusively.
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;
grant select, insert, update, delete on public.oauth_states to service_role;

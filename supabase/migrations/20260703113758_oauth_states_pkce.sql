-- PKCE support: some OAuth servers (e.g. "Sign in with Vercel") require a
-- code_challenge at authorize time and the matching code_verifier at token
-- exchange. oauth-start stores the verifier here; oauth-callback replays it.
alter table public.oauth_states
  add column if not exists code_verifier text;

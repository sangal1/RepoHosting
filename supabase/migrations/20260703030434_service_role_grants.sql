-- Ensure the service role (used by edge functions to write secret token
-- columns) has full DML on RepoHosting tables. Supabase's default privileges
-- normally cover this on hosted projects, but granting explicitly makes local
-- stacks and every environment behave identically.
grant select, insert, update, delete on public.connector_credentials to service_role;
grant select, insert, update, delete on public.profiles to service_role;

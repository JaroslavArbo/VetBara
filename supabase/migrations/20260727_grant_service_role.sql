-- Ensure the API's service_role can access the application tables.
--
-- Hosted Supabase auto-grants privileges to service_role for objects created by
-- the dashboard/postgres role, but raw `supabase` CLI migrations applied locally
-- (or in CI) do not always inherit that, which surfaces as PostgREST
--   42501 "permission denied for table ..."
-- when the serverless /api functions query with the service_role key.
--
-- Only service_role is granted here on purpose: the browser never talks to
-- Supabase directly — every read/write goes through the server-side /api
-- functions using the service role — so anon/authenticated need no access, and
-- granting it to them would expose the tables to anyone holding the anon key.
--
-- Runs after all table-creating migrations so "all tables" covers them; the
-- ALTER DEFAULT PRIVILEGES lines keep future tables covered too. Idempotent and
-- safe to re-run in any environment.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

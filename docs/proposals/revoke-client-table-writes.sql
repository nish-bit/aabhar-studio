-- NOT APPROVED — do not apply. Kept out of supabase/migrations/ on purpose so that
-- `supabase db push` (or any CI/CD) cannot apply it. To adopt it after approval,
-- copy it to supabase/migrations/ with a new timestamp.
--
-- Defence in depth: browser roles (anon, authenticated) never write tables directly.
--
-- Every write goes through the server, as service_role (src/server/db/supabase-admin.ts)
-- or the postgres connection (src/server/db/postgres.ts); the browser only uses Supabase
-- Auth and signed Storage uploads. RLS already denies these roles every INSERT, UPDATE
-- and DELETE (the only client policies are member-scoped SELECTs), but Supabase's
-- default grants still give them TRUNCATE, which RLS does not cover, plus REFERENCES
-- and TRIGGER. Remove the privileges nobody uses. SELECT stays: it is still filtered
-- by the RLS policies.
--
-- service_role and postgres are untouched.

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Tables created by later migrations don't get these privileges either.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

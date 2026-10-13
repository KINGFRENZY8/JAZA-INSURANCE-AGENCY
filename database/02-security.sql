-- =====================================================================
-- Step 2 of 2: lock the database down and create a limited user for your API.
-- Run in the Supabase SQL Editor AFTER 01-admin-migration.sql.
-- Why: Supabase can publish tables to the internet through its automatic "Data API". Your site
-- uses its own Express API instead, so we shut the automatic API out completely, and we stop the
-- API using the all-powerful "postgres" login.
-- =====================================================================
BEGIN;

-- 1. Row Level Security on every table, and nothing for Supabase's public API roles
ALTER TABLE public.quote_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- 2. The API's own database user (the password is set separately, see the bottom)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jaza_app') THEN
    CREATE ROLE jaza_app LOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO jaza_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jaza_app;

-- Exactly what the API needs, and nothing more:
GRANT SELECT, INSERT ON public.quote_requests TO jaza_app;                       -- website forms add rows
GRANT UPDATE (status, assigned_to, updated_at) ON public.quote_requests TO jaza_app;  -- staff can only change these
GRANT SELECT, INSERT ON public.admin_users TO jaza_app;                          -- no deleting staff, only deactivate
GRANT UPDATE (password_hash, must_change_password, failed_login_count, locked_until,
              last_login_at, updated_at) ON public.admin_users TO jaza_app;
GRANT SELECT, INSERT ON public.admin_audit_logs TO jaza_app;                     -- append-only: no edits, no deletes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session TO jaza_app;              -- login sessions

-- 3. Row Level Security policies: only jaza_app passes. No policy for anyone else = no access.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['quote_requests','admin_users','admin_audit_logs','session'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS jaza_app_all ON public.%I', t);
    EXECUTE format('CREATE POLICY jaza_app_all ON public.%I FOR ALL TO jaza_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMIT;

-- 4. SET THE PASSWORD. Run this ONE line on its own. Use a long random password of letters and
--    numbers only (make it in a password manager). Then delete this snippet from the SQL
--    editor's history so the password is not kept there.
--      ALTER ROLE jaza_app WITH PASSWORD 'put-a-long-random-password-here';

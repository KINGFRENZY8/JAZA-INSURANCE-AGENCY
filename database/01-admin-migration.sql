-- =====================================================================
-- Step 1 of 2: small upgrades to your CURRENT admin tables (run in the Supabase SQL Editor).
-- Safe to run more than once. Everything runs as one all-or-nothing transaction.
-- =====================================================================
BEGIN;

-- Login protection and first-login password change
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Allow the roles you confirmed: admin, manager, staff (office staff)
DO $$ DECLARE c TEXT; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.admin_users'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP EXECUTE format('ALTER TABLE public.admin_users DROP CONSTRAINT %I', c); END LOOP;
END $$;
ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin','manager','staff'));

-- One account per email, whatever the capital letters
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_lower_uq ON public.admin_users (lower(email));

-- Know when a quote was last changed
ALTER TABLE public.quote_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Where login sessions are stored (used by connect-pg-simple)
CREATE TABLE IF NOT EXISTS public.session (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON public.session (expire);

COMMIT;

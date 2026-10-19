-- Jaza Insurance Agency: lets staff edit their own name and job title from the My Profile page.
-- Run once as the database OWNER (not as jaza_app). Safe to run again.
-- Everything else in the portal works without this; only the "Edit profile" button needs it.
GRANT UPDATE (full_name, job_title) ON public.admin_users TO jaza_app;

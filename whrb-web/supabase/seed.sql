-- WHRB prospects — seed data (Stage 1)
-- =========================================================================
-- Idempotent + order-safe. Runs AFTER 000_init.sql.
--
-- Two-step flow (see plan clarifications round 5):
--   1) Backfill profiles for any auth.users rows that existed BEFORE the
--      on_auth_user_created trigger was installed. Normally the trigger
--      creates a profile at invite time; but on first-ever Stage 1 cutover
--      the admin was invited before the migration ran, so no profile exists
--      until this INSERT.
--   2) Promote the admin (kingyareh@gmail.com) to role='admin'.
--
-- Safe to run multiple times: the INSERT uses ON CONFLICT DO NOTHING, and
-- the UPDATE is a no-op once role is already 'admin'.
-- =========================================================================

insert into public.profiles (id, email, role)
select id, email, 'rep'
from auth.users
on conflict (id) do nothing;

update public.profiles
set role = 'admin'
where email = 'kingyareh@gmail.com';

-- (No source_config seeding here yet; that's Stage 2's responsibility when
-- supabase_sync.py is wired in.)

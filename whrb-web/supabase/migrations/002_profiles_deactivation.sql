-- =========================================================================
-- 002_profiles_deactivation.sql
-- Stage 9 admin-console feature: reversible user deactivation.
--
-- Plan §7.4 calls for a "deactivate control" on /admin/users but 000_init.sql
-- has no column for it. Round-8 §19.2 locked in this migration:
--
--   * Adds `deactivated_at timestamptz` to public.profiles (nullable).
--     NULL   → active user (default).
--     NOT NULL → deactivated at that instant.
--
--   * Hard-delete path (the "Remove" admin control) does not need a schema
--     change — it calls supabase.auth.admin.deleteUser(id) which cascades
--     through profiles.id → auth.users(id) on delete cascade.
--
--   * Enforcement of deactivation lives in whrb-web/middleware.ts (signs the
--     user out + redirects to /login?deactivated=1). No DB-layer block is
--     added here because Supabase does not allow custom auth.users triggers.
--
-- Idempotent: `add column if not exists`.
-- =========================================================================

alter table public.profiles
  add column if not exists deactivated_at timestamptz;

comment on column public.profiles.deactivated_at is
  'Set by /admin/users Deactivate action; non-null blocks sign-in via middleware. Cleared by Reactivate.';

-- =========================================================================
-- End of 002_profiles_deactivation.sql
-- =========================================================================

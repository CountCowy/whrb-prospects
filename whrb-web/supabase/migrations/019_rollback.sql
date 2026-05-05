-- =========================================================================
-- 019_rollback.sql — reverse of 019_bulk_update_prospects.sql
--
-- Drops the bulk_update_prospects RPC. Idempotent. Safe even if the
-- pipeline currently has the function in flight; PostgREST caches
-- function metadata briefly but a re-create restores it.
-- =========================================================================

drop function if exists public.bulk_update_prospects(jsonb);

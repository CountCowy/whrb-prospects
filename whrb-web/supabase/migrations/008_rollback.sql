-- WHRB prospects — rollback for 008_daypart_view.sql
-- =========================================================================
-- Drops everything added by 008 in reverse order of creation. Safe to run
-- multiple times (IF EXISTS guards).
--
-- Does NOT touch 007_tag_schema.sql objects (tag_vocabulary,
-- prospect_tags base columns, RLS policies, merge_tag_vocabulary RPC) —
-- those have their own 007_rollback.sql.
-- =========================================================================

-- 1) prospect_daypart view
drop view if exists public.prospect_daypart;

-- 2) derive_daypart function
drop function if exists public.derive_daypart(uuid);

-- 3) pipeline_runs.tag_sync_status
alter table public.pipeline_runs
  drop column if exists tag_sync_status;

-- 4) prospect_tags soft-clear columns + partial index
drop index if exists public.idx_prospect_tags_suppressed;

alter table public.prospect_tags
  drop column if exists suppressed_at,
  drop column if exists suppressed_by;

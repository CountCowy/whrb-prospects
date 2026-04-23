-- WHRB prospects — rollback for 007_tag_schema.sql
-- =========================================================================
-- Drops everything 007_tag_schema.sql added, in dependency order.
-- The notifications.kind constraint is restored to its 000_init.sql value.
-- See ROLLBACK.md for the operator procedure.
-- =========================================================================

-- 1) Drop dependent triggers first.
drop trigger if exists t_prospect_tags_audit on public.prospect_tags;
drop trigger if exists t_tag_vocabulary_rep_insert on public.tag_vocabulary;
drop trigger if exists t_tag_vocabulary_updated_at on public.tag_vocabulary;

-- 2) Drop functions.
drop function if exists public.audit_prospect_tag_change() cascade;
drop function if exists public.on_rep_tag_vocab_insert() cascade;
drop function if exists public.merge_tag_vocabulary(uuid, uuid) cascade;

-- 3) Drop tables (prospect_tags first because it FK's to tag_vocabulary).
drop table if exists public.prospect_tags cascade;
drop table if exists public.tag_vocabulary cascade;

-- 4) Restore notifications.kind constraint to its 000_init.sql value.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'assigned','unassigned','note_mention','run_complete','feedback_status'
  ));

-- =========================================================================
-- End of 007_rollback.sql
-- =========================================================================

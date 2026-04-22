-- Stage 10b — notes_internal column
-- =========================================================================
-- Adds `prospects.notes_internal text` as a free-text, internal-only field
-- used for test-fixture tagging (plant scripts mark synthetic rows with
-- a recognisable marker so cleanup can delete exactly the planted set).
--
-- Idempotent via `add column if not exists`. Safe to re-run.
-- =========================================================================

alter table public.prospects
  add column if not exists notes_internal text;

comment on column public.prospects.notes_internal is
  'Internal free-text tag used by test fixtures and admin notes. Never surfaced on the pipeline CSV path.';

-- Add Stage 10b tables to the Realtime publication so the
-- NotificationBell, PresenceChips, and kanban presence-dot clients can
-- subscribe to INSERT/UPDATE events. Wrapped in exception handlers so the
-- migration is idempotent: re-running a statement that already added the
-- table raises `duplicate_object`, which we swallow.
do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.prospect_presence;
  exception when duplicate_object then null;
  end;
end
$$;

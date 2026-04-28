-- 013_rollback.sql — Reverse migration for 013_schedule_fixes.sql.
--
-- Restores the original 012 shape of:
--   * `idx_sched_external_unique` on (external_source, external_id).
--   * No CHECK on schedule_event_reminders.fire_at beyond NOT NULL.
--
-- Idempotent: every drop + create uses IF EXISTS / IF NOT EXISTS.

-- 1) Drop the tripwire CHECK.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'sched_reminder_fire_at_tripwire'
      and conrelid = 'public.schedule_event_reminders'::regclass
  ) then
    alter table public.schedule_event_reminders
      drop constraint sched_reminder_fire_at_tripwire;
  end if;
end $$;

-- 2) Restore the global (external_source, external_id) unique index.
--
-- WARNING: if the per-feed shape was used to admit two rows that share
-- (external_source, external_id) but differ on external_calendar_id, the
-- restore will fail with a unique-violation. That should not happen in
-- practice — only one calendar in dev — but inspect before rollback if
-- you've added a second feed.
drop index if exists public.idx_sched_external_unique;

create unique index if not exists idx_sched_external_unique
  on public.schedule_events (external_source, external_id)
  where external_source is not null;

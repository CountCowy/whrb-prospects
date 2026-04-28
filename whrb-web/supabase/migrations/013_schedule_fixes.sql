-- 013_schedule_fixes.sql — Schedule Feature follow-ups (post-012 review).
--
-- Two fixes carved out of the schedule code review:
--
--   1) Tighten the imported-event unique index to be per-feed. The 012
--      shape `(external_source, external_id)` was global, so a malicious
--      ICS feed could hijack another feed's events by reusing a UID. The
--      new shape `(external_source, external_calendar_id, external_id)`
--      keeps the upsert idempotent per-feed.
--
--   2) Add a tripwire CHECK on `schedule_event_reminders.fire_at`.
--      The derive_schedule_reminder_fire_at BEFORE-INSERT trigger
--      overwrites the placeholder API callers send. If the trigger ever
--      fails to fire (e.g. table renamed, trigger dropped during a future
--      migration), this CHECK prevents an always-due fire_at from being
--      persisted, where the dispatcher would otherwise fire it
--      immediately. Existing rows are validated up front because the
--      trigger has been overwriting placeholders since 012, so any real
--      fire_at is already `event.starts_at - lead_minutes`.
--
-- Idempotent: every drop + create uses IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.

-- =========================================================================
-- 1) Per-feed unique index for imported events
-- =========================================================================

drop index if exists public.idx_sched_external_unique;

create unique index if not exists idx_sched_external_unique
  on public.schedule_events (external_source, external_calendar_id, external_id)
  where external_source is not null;

-- =========================================================================
-- 2) Tripwire CHECK on schedule_event_reminders.fire_at
-- =========================================================================

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

alter table public.schedule_event_reminders
  add constraint sched_reminder_fire_at_tripwire
  check (fire_at > timestamptz '2000-01-01');

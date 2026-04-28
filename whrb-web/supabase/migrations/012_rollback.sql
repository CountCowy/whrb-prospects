-- 012_rollback.sql — Schedule Feature reverse migration.
--
-- Drops the schedule tables, triggers, dispatcher function, cron job, RLS
-- policies, and the notifications.kind extension. Idempotent: every drop
-- uses IF EXISTS so the script is safe to re-run.

-- 1) Unschedule pg_cron job.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'dispatch_schedule_reminders';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end $$;

-- 2) Drop dispatcher function.
drop function if exists public.dispatch_schedule_reminders(timestamptz);

-- 3) Drop triggers + helper functions.
drop trigger if exists t_sched_block_external_writes on public.schedule_events;
drop function if exists public.block_external_event_user_writes();

drop trigger if exists t_sched_reschedule on public.schedule_events;
drop function if exists public.sync_schedule_reminder_fire_at();

drop trigger if exists t_sched_reminder_derive_fire_at on public.schedule_event_reminders;
drop function if exists public.derive_schedule_reminder_fire_at();

drop trigger if exists t_sched_events_updated_at on public.schedule_events;
drop trigger if exists t_user_sched_prefs_updated_at on public.user_schedule_preferences;
drop trigger if exists t_sched_external_calendars_updated_at on public.schedule_external_calendars;

-- 4) Drop RLS policies.
drop policy if exists p_user_sched_prefs_self on public.user_schedule_preferences;
drop policy if exists p_sched_rem_write on public.schedule_event_reminders;
drop policy if exists p_sched_rem_read on public.schedule_event_reminders;
drop policy if exists p_sched_delete on public.schedule_events;
drop policy if exists p_sched_update on public.schedule_events;
drop policy if exists p_sched_insert on public.schedule_events;
drop policy if exists p_sched_read on public.schedule_events;
drop policy if exists p_sched_ext_cal_admin on public.schedule_external_calendars;

-- 5) Drop tables (FK order: reminders first, then events, then external/prefs).
drop index if exists idx_sched_reminder_recipient;
drop index if exists idx_sched_reminder_due;
drop table if exists public.schedule_event_reminders;

drop index if exists idx_sched_external_unique;
drop index if exists idx_sched_prospect;
drop index if exists idx_sched_series;
drop index if exists idx_sched_assigned;
drop index if exists idx_sched_starts_category;
drop index if exists idx_sched_starts_at;
drop table if exists public.schedule_events;

drop table if exists public.schedule_external_calendars;
drop table if exists public.user_schedule_preferences;

-- 6) Drop enums (only after their dependent tables are gone).
drop type if exists public.schedule_event_visibility;
drop type if exists public.schedule_reminder_channel;
drop type if exists public.schedule_assignee_kind;
drop type if exists public.schedule_event_category;

-- 7) Drop any schedule_reminder rows so the restored CHECK constraint can
-- apply. Destructive if reminders were live; comment out if you need to
-- preserve that history before rolling back.
delete from public.notifications where kind = 'schedule_reminder';

-- 8) Restore notifications.kind constraint to pre-012 state.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_kind_check'
  ) then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
end $$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'assigned',
    'unassigned',
    'note_mention',
    'run_complete',
    'feedback_status'
  ));

-- 014_cron_state.sql — Dedicated table for cron-job idempotence cursors.
--
-- Carved out of T4 deferred follow-up L7. The nightly
-- `prune_event_log.py` cron stashes its "did I run today?" cursor as a
-- synthetic row in `pipeline_runs` with `args = 'prune_event_log:<DATE>'`,
-- which pollutes the audit table that powers `/admin/runs`. The
-- pipeline_run_dispatch trigger (003_pipeline_dispatch_webhook.sql)
-- filters on status='queued' so synthetic rows do NOT trigger GitHub
-- dispatch, and run-complete notifications are emitted by application
-- code rather than by a row trigger — so the impact today is purely
-- cosmetic (operations dashboard clutter). This migration replaces the
-- hack with a real table and backfills the existing synthetic rows.
--
-- Idempotent: every drop + create uses IF EXISTS / IF NOT EXISTS.

-- =========================================================================
-- 1) cron_state — one row per recurring job, key is opaque + caller-owned.
-- =========================================================================

create table if not exists public.cron_state (
  key         text primary key,
  last_run_at timestamptz not null default now()
);

comment on table public.cron_state is
  'Cron-job idempotence cursors. One row per recurring job (key = opaque '
  'identifier owned by the caller, e.g. ''prune_event_log''). last_run_at '
  'is updated by the job at the end of each successful run. Used by '
  'whrb-prospects/scripts/prune_event_log.py and any future ops cron.';

-- =========================================================================
-- 2) RLS — admins can read for /admin diagnostics; writes only via service
--    role (cron runs as superuser/service role and bypasses RLS).
-- =========================================================================

alter table public.cron_state enable row level security;

drop policy if exists p_cron_state_read on public.cron_state;
create policy p_cron_state_read on public.cron_state
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- No write policy: JWT-authed clients cannot INSERT/UPDATE/DELETE.
-- Service-role connections bypass RLS, which is exactly what we want
-- for cron jobs that connect via the DB password.

-- =========================================================================
-- 3) Backfill: clean up synthetic prune_event_log:* rows from pipeline_runs.
--    These were the L7 hack; with cron_state in place they're noise.
--    Stamp cron_state with the latest existing cursor date so the next
--    nightly run still no-ops if it already ran today.
-- =========================================================================

do $$
declare
  v_latest timestamptz;
begin
  select max(finished_at)
    into v_latest
    from public.pipeline_runs
   where args like 'prune_event_log:%';

  if v_latest is not null then
    insert into public.cron_state (key, last_run_at)
    values ('prune_event_log', v_latest)
    on conflict (key) do update
      set last_run_at = greatest(public.cron_state.last_run_at, excluded.last_run_at);
  end if;

  delete from public.pipeline_runs
   where args like 'prune_event_log:%';
end $$;

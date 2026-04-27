-- 011_rollback.sql — Stage T4 reverse migration.
--
-- Drops the changelog surface, rollups, instrumentation tables, and the
-- source_config status extensions. Idempotent: every drop uses IF EXISTS so
-- the script is safe to re-run.

-- 1) Drop changelog surface.
drop policy if exists p_changelog_write on public.changelog_entries;
drop policy if exists p_changelog_select on public.changelog_entries;
drop table if exists public.changelog_entries;

alter table public.profiles
  drop column if exists last_changelog_ack;

-- 2) Drop source_config sync trigger + status columns.
drop trigger if exists t_source_config_status_enabled on public.source_config;
drop function if exists public.sync_source_config_status_enabled();

drop index if exists source_config_status;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'source_config_status_check'
  ) then
    alter table public.source_config drop constraint source_config_status_check;
  end if;
end $$;

alter table public.source_config drop column if exists status_changed_at;
alter table public.source_config drop column if exists status;

-- 3) Drop event_log_stats.
drop policy if exists p_event_log_stats_select on public.event_log_stats;
drop index if exists event_log_stats_week;
drop table if exists public.event_log_stats;

-- 4) Drop filter_impression_stats.
drop policy if exists p_fi_stats_select on public.filter_impression_stats;
drop index if exists filter_impression_stats_week;
drop table if exists public.filter_impression_stats;

-- 5) Drop filter_impressions.
drop policy if exists p_filter_impressions_insert on public.filter_impressions;
drop policy if exists p_filter_impressions_select on public.filter_impressions;
drop index if exists filter_impressions_daily_unique;
drop index if exists filter_impressions_user;
drop index if exists filter_impressions_prospect;
drop table if exists public.filter_impressions;

-- 6) Remove the dedupe_match backfill rows.
delete from public.event_log
where category = 'dedupe_match'
  and context ->> 'backfill' = 'true';

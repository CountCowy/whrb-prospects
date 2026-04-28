-- 014_rollback.sql — Reverse migration for 014_cron_state.sql.
--
-- Drops the cron_state table. NOTE: this does NOT re-create the
-- synthetic `prune_event_log:<DATE>` rows in pipeline_runs that the
-- forward migration deleted. After rollback, the next prune_event_log
-- run will be unguarded and may delete rows it already processed today;
-- that's tolerable because _aggregate_then_delete is idempotent under
-- the time-window WHERE clause (rows already gone are not re-deleted),
-- but it will produce a duplicate event_log_stats roll-up for any
-- already-processed bucket. Run prune_event_log no more than once per
-- day during the rollback window.

drop policy if exists p_cron_state_read on public.cron_state;
drop table if exists public.cron_state;

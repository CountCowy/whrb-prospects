-- Stage 10c — pipeline_runs.github_run_id
-- =========================================================================
-- Adds `pipeline_runs.github_run_id bigint` (nullable) so the Stage 10c
-- cancel API can target the matching GitHub Actions workflow run via
-- `POST /repos/.../actions/runs/{id}/cancel` when a row is in status='running'.
--
-- The workflow (`.github/workflows/run-pipeline.yml`) is extended in Stage 10c
-- to stamp `github_run_id = ${{ github.run_id }}` when it transitions a row
-- from queued → running (and when it inserts the `running` row directly on
-- schedule / workflow_dispatch paths).
--
-- Existing rows (4 Stage-10 audit + post-merge scheduled/manual runs) remain
-- null; backfill is not attempted. New runs populate on the next workflow
-- execution.
--
-- Idempotent via `add column if not exists`. Safe to re-run.
-- =========================================================================

alter table public.pipeline_runs
  add column if not exists github_run_id bigint;

comment on column public.pipeline_runs.github_run_id is
  'GitHub Actions workflow run ID (github.run_id). Populated by run-pipeline.yml when transitioning queued→running or inserting on schedule/workflow_dispatch. Used by the Stage 10c cancel API to POST /repos/.../actions/runs/{id}/cancel.';

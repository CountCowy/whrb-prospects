-- Stage 10c follow-up — skip fixture rows in the dispatch trigger.
-- =========================================================================
-- Stage 10c's Playwright T05/T06 specs POST to `/api/pipeline/run` to
-- exercise the argv whitelist + canonicalisation. The API inserts a
-- `pipeline_runs` row with `status='queued'`, which today causes
-- `dispatch_pipeline_run()` to fire the github-dispatch Edge Function
-- regardless of whether the row is real admin work or a test fixture.
--
-- Result during Stage 10c's first preview run: two test-triggered workflow
-- runs queued behind a real admin trigger, blocking the user's run via the
-- `concurrency: pipeline-run` group.
--
-- Fix: skip dispatch when `args` contains the `--stage10c-fixture`
-- sentinel. The sentinel is added to the API's argv whitelist (admin-only;
-- not a real pipeline.py flag). The workflow also strips it defensively
-- before invoking pipeline.py.
--
-- Backwards-compatible: real admin runs never include the sentinel, so
-- their dispatch behaviour is unchanged.
-- =========================================================================

create or replace function public.dispatch_pipeline_run()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Only forward queued rows; workflow INSERTs land with status='running'
  -- (plan §21.1 chicken-and-egg loop avoidance).
  if new.status <> 'queued' then
    return new;
  end if;

  -- Stage 10c: test-fixture rows must not trigger real workflow runs.
  -- The `--stage10c-fixture` sentinel marks rows as fixture-only. See
  -- whrb-web/app/api/pipeline/run/route.ts (FLAG_WHITELIST) and
  -- whrb-web/e2e/stage10c/run-flags.spec.ts.
  if new.args is not null and new.args like '%--stage10c-fixture%' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://kolfijjavwruwzctmnlx.supabase.co/functions/v1/github-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'pipeline_runs',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

-- Trigger binding unchanged from 003; function body replaced above.
comment on function public.dispatch_pipeline_run() is
  'Stage 10 Path A proxy (Stage 10c: skips rows with --stage10c-fixture '
  'in args so test harness inserts never fire real workflow dispatches).';

-- 003_pipeline_dispatch_webhook.sql — Stage 10 (round-10 §21 item 6 + §20.4)
--
-- Wire pipeline_runs INSERT with status='queued' → github-dispatch Edge
-- Function → GitHub repository_dispatch. Implements Path A (Edge Function
-- proxy) via a database trigger rather than the Supabase Dashboard
-- Database Webhook, because the Dashboard's current UI on WHRB dev does
-- not let us template the request body to GitHub's shape or filter on
-- `status='queued'` (plan §20.3 items 1 + 2). The trigger here writes the
-- exact envelope the dashboard webhook would have emitted, so the Edge
-- Function's verification logic is identical.
--
-- pg_net + http extensions ship with Supabase Cloud; no separate enable is
-- needed (they are preinstalled on the `extensions` schema).

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

drop trigger if exists pipeline_run_dispatch on public.pipeline_runs;
create trigger pipeline_run_dispatch
after insert on public.pipeline_runs
for each row
execute function public.dispatch_pipeline_run();

-- Diagnostic comment so `\df+` / Dashboard shows the intent.
comment on function public.dispatch_pipeline_run() is
  'Stage 10 Path A proxy: forwards queued pipeline_runs INSERTs to the '
  'github-dispatch Edge Function, which calls GitHub''s repository_dispatch.';
comment on trigger pipeline_run_dispatch on public.pipeline_runs is
  'Stage 10 (round-10 §21.2): replaces the Dashboard webhook so the Edge '
  'Function receives a Supabase-compatible envelope.';

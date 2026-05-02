"""Adopt or create a pipeline_runs row at the start of a workflow run.

Invoked by .github/workflows/run-pipeline.yml. Three trigger paths:

- repository_dispatch: a queued row already exists (the API inserted it).
  Flip status='queued' -> 'running' and stamp started_at + github_run_id.
  Read back ``args`` so the workflow can honor admin-selected flags.

- schedule / workflow_dispatch: no queued row exists. INSERT a fresh row
  already in 'running' state so the github-dispatch Edge Function (which
  filters on status='queued') doesn't re-dispatch and create a loop.

Outputs ``run_id`` and ``args`` to GITHUB_OUTPUT so subsequent workflow
steps can read them.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  EVENT_NAME              -- github.event_name
  GITHUB_RUN_ID           -- github.run_id
  GITHUB_OUTPUT           -- workflow output file path
  DISPATCH_RUN_ID         -- only on repository_dispatch
"""
from __future__ import annotations

import os
import sys
from datetime import UTC, datetime

from supabase import create_client


def main() -> int:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    event = os.environ["EVENT_NAME"]
    gh_run_id = int(os.environ.get("GITHUB_RUN_ID") or 0) or None

    sb = create_client(url, key)
    now = datetime.now(tz=UTC).isoformat()

    if event == "repository_dispatch":
        run_id = os.environ.get("DISPATCH_RUN_ID") or ""
        if not run_id:
            print(
                "::error::repository_dispatch payload missing pipeline_run_id",
                file=sys.stderr,
            )
            return 1
        update_patch: dict[str, object] = {
            "status": "running",
            "started_at": now,
        }
        if gh_run_id is not None:
            update_patch["github_run_id"] = gh_run_id
        res = (
            sb.table("pipeline_runs")
            .update(update_patch)
            .eq("id", run_id)
            .eq("status", "queued")
            .execute()
        )
        if not res.data:
            print(
                f"::warning::no queued row matched id={run_id}; continuing for forensic trace",
                file=sys.stderr,
            )
    else:
        # schedule / workflow_dispatch — insert a fresh `running` row so the
        # Edge Function (which filters on status='queued') never re-dispatches.
        args_str = "--scheduled" if event == "schedule" else "--manual"
        insert_row: dict[str, object] = {
            "status": "running",
            "started_at": now,
            "triggered_by": None,
            "args": args_str,
        }
        if gh_run_id is not None:
            insert_row["github_run_id"] = gh_run_id
        res = sb.table("pipeline_runs").insert(insert_row).execute()
        run_id = (res.data[0] if res.data else {}).get("id") or ""
        if not run_id:
            print("::error::failed to insert pipeline_runs row", file=sys.stderr)
            return 1

    # Read back args for repository_dispatch so the Run pipeline step honors
    # admin-selected flags. Schedule / workflow_dispatch paths keep the
    # hardcoded --with-hic invocation downstream.
    args_out = ""
    if event == "repository_dispatch":
        fetched = (
            sb.table("pipeline_runs")
            .select("args")
            .eq("id", run_id)
            .single()
            .execute()
        )
        args_out = ((fetched.data or {}).get("args") or "").strip()

    print(f"[pipeline_runs] run_id={run_id} github_run_id={gh_run_id} args={args_out!r}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"run_id={run_id}\n")
        f.write(f"args={args_out}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

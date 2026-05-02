"""Finalize a pipeline_runs row after the pipeline step completes.

Invoked by .github/workflows/run-pipeline.yml as the always() step that
runs whether the pipeline succeeded or failed. Reads the pipeline log,
extracts the [pipeline_summary] line emitted by pipeline.py, and
updates the pipeline_runs row with status / rows_upserted / error /
finished_at.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  RUN_ID                  -- the pipeline_runs row id (from adopt step)
  PIPELINE_STATUS         -- the GitHub Actions step outcome of the
                             pipeline run (success / failure / cancelled)
"""
from __future__ import annotations

import os
import re
import sys
from datetime import UTC, datetime

from supabase import create_client

LOG_PATH = "cache/pipeline.log"
SUMMARY_RE = re.compile(
    r"\[pipeline_summary\] status=(\S+) rows_upserted=(\d*) error=(.*)"
)


def main() -> int:
    run_id = os.environ.get("RUN_ID") or ""
    if not run_id:
        print("no run_id to finalize", file=sys.stderr)
        return 0

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Default status from the GitHub Actions step outcome; the
    # pipeline-emitted summary line (parsed below) overrides this when
    # present, since the pipeline knows more than `step.outcome` does.
    step_outcome = os.environ.get("PIPELINE_STATUS") or "failure"
    status = "success" if step_outcome == "success" else "failed"

    rows_upserted: int | None = None
    err: str | None = None
    tail = ""
    try:
        with open(LOG_PATH, encoding="utf-8", errors="replace") as f:
            text = f.read()
        matches = SUMMARY_RE.findall(text)
        if matches:
            status_tok, rows_tok, err_tok = matches[-1]
            if rows_tok:
                rows_upserted = int(rows_tok)
            if err_tok.strip():
                err = err_tok.strip()[:400]
            status = status_tok  # pipeline-reported status wins
        tail = text[-800:] if text else ""
    except FileNotFoundError:
        pass

    if status == "failed" and not err:
        err = (tail or "pipeline exited non-zero; no summary line emitted").strip()[
            :400
        ]

    patch: dict[str, object] = {
        "status": status,
        "finished_at": datetime.now(tz=UTC).isoformat(),
    }
    if rows_upserted is not None:
        patch["rows_upserted"] = rows_upserted
    if err:
        patch["error"] = err

    sb.table("pipeline_runs").update(patch).eq("id", run_id).execute()
    print(
        f"[pipeline_runs] finalized id={run_id} status={status} rows={rows_upserted}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

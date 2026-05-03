# Schedule feature review pass (2026-04-27)

A `/code-review` pass on branch `schedule/schema` (PRs 1–5) surfaced 22
inline fixes (4 critical, 7 high, 11 medium). All landed in this branch;
follow-up migration `013_schedule_fixes.sql` re-shapes the imported-event
unique index per-feed and adds a tripwire CHECK on
`schedule_event_reminders.fire_at`. Apply with
`scripts/apply_schedule_fixes_migration.py`.

### Schedule deferred follow-ups (not blocking schedule/schema merge)

| ID | File / surface | Issue | Why deferred | Suggested home |
|----|---------------|-------|--------------|----------------|
| S1 | `whrb-prospects/requirements.lock`, `.github/workflows/external-calendar-sync.yml` | `icalendar==6.1.0` and `recurring-ical-events==3.4.0` are pinned in `requirements.txt` but **not in `requirements.lock`**. The workflow installs them in a separate `pip install 'icalendar==…' 'recurring-ical-events==…'` step. The fallback `pip install -r requirements.lock \|\| pip install -r requirements.txt` (which would have silently swallowed unpinned deps) was dropped in this branch — but the proper fix is to fold the ICS deps into the lockfile and switch the workflow to `pip install --require-hashes -r requirements.lock`. | The current lockfile was generated without `--generate-hashes`, so flipping `--require-hashes` on requires regenerating the entire lockfile (cascading changes across every pinned dep, ~213 lines). Doing that mid-review-fix would obscure the diff. | Standalone "lockfile rehash" PR after `schedule/schema` merges: run `pip-compile --generate-hashes --output-file=requirements.lock requirements.txt`, drop the explicit ICS install step, switch the lockfile install to `pip install --require-hashes --no-deps -r requirements.lock`, sanity-run the workflow once, then commit. |


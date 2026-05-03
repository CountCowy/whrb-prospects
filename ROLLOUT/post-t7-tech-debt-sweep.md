# Post-T7 tech-debt sweep (2026-05-01 → 2026-05-02)

Two-PR sweep grouped from the April 2026 code-health review. Plan:
[`/Users/countcowy/.claude/plans/draft-a-plan-for-wiggly-avalanche.md`](../.claude/plans/draft-a-plan-for-wiggly-avalanche.md).
**Not a Stage** — "Stage" is reserved for the official ROLLOUT roadmap;
this is quality-of-life work that ships between T7 and T8.

| PR | Branch | Scope |
|---|---|---|
| [#47](https://github.com/CountCowy/whrb-prospects/pull/47) | `tech-debt/rollout-shard-and-source-typing` | ROLLOUT.md → 31 shards under `ROLLOUT/` (this file lives there); `sources/_base.py` typing contract (`ProspectRow` TypedDict, `RunAll` alias, `ProspectSource` Protocol); 3 representative source migrations (`ma_arborists`, `harvard_orgs`, `ma_alr`); **T7 phone-write bug fix** in `_t7_common.build_row` (was writing `row["phone"]`, silently dropped by `CSV_COLUMNS` and `SCRAPED_FIELDS` — every T7 source's phone field was lost on write). |
| [#48](https://github.com/CountCowy/whrb-prospects/pull/48) | `tech-debt/sentry-and-python-coverage` | Sentry (`@sentry/nextjs@10.51`) on `whrb-web` alongside (not in place of) the Supabase `event_log` sink; gated on `SENTRY_DSN` so unsetting it in Vercel is the kill switch. `util/+enrich/` Python coverage **45.6% → 71.84%**, enforced by a new narrower CI gate (`--cov=util --cov=enrich --cov-fail-under=70`). |

### Code-review fixes (2026-05-02)

A `/code-review` pass on the two PRs surfaced one critical bug, one
medium regression, and a handful of security / correctness items.
All landed as a single fix-up commit on each PR branch:

| ID | PR | File | Issue | Severity |
|----|----|------|-------|----------|
| C1 | #48 | `whrb-web/next.config.ts` | `tunnelRoute: '/monitoring'` collided with the auth middleware matcher (which excludes `api/` only). Unauthenticated client POSTs from the login page were being redirected to `/login`, dropping every pre-auth Sentry event. Moved to `/api/monitoring`. | 🔴 Critical |
| M1 | #47 | `whrb-prospects/scripts/t1_integrity.py` | Post-shard refactor introduced `if not cert_found and not failures` which silently dropped the cert-line failure when any prior check (a) failure existed. Restored unconditional reporting per pre-shard behavior. | 🟠 Medium |
| M2 | #48 | `whrb-web/lib/observability/sentry.ts` | Added breadcrumb URL scrubbing (auth-flow query params: `code`, `reset_token`, `invite`, `*_token`); tightened `SENSITIVE_FIELD_PATTERN` with `\b…\b` word boundaries (no more `passenger`/`passport`/`tokenizer` false-positives); also scrub `request.url`. | 🟡 Security |
| M3 | #48 | `whrb-web/lib/logging/server.ts` | Wrapped both Sentry calls in try/catch so an SDK failure cannot preempt the Supabase audit-log write — the in-DB trail is the source of truth. | 🟡 Correctness |
| L1 | #47 | `whrb-prospects/sources/_base.py` | Marked `company_name` / `source` / `tier` as `Required[str]` so the type matches the docstring; dropped the `_: Any = None` import-pinning workaround. | Style |
| L2 | #47 | `bin/split_rollout.py` | Replaced fragile `len(text.splitlines()) < 20` heuristic in `is_already_split` with a literal pointer-string match. | Style |
| L3 | #48 | `whrb-prospects/tests/test_email_validate.py` | `reset_mx_cache` fixture return type → `Iterator[None]`. | Style |

### Deferred follow-ups (not blocking either PR)

| ID | File / surface | Issue | Why deferred | Suggested home |
|----|----------------|-------|--------------|----------------|
| D1 | `whrb-prospects/pyproject.toml` mypy `files` list | `_safe_cached(label, fn: RunAll) -> list[ProspectRow]` is currently aspirational — `pipeline.py` is not in mypy's file list, so a source returning `list[dict]` instead of `list[ProspectRow]` is not caught. | Adding `pipeline.py` to mypy needs simultaneous migration of more sources, or it breaks the build on the 38 unmigrated ones. | Standalone PR after the next batch of source migrations lands. |
| D2 | `whrb-web/lib/server/authz.ts` | `getAuthed()` does a hidden side-effect (`setSentryUserFromAuthed`) inside a function that reads as a pure auth read. | Centralising it removes the "did I forget to scope the user?" footgun on every route handler. Tradeoff is real, not urgent. | Either rename, move the call to route handlers, or document with stronger JSDoc — pick one in a follow-up. |
| D3 | `.github/workflows/whrb-prospects-ci.yml` | Pytest runs twice (whole-package floor + util/+enrich/ 70% gate). | Combining into one invocation needs per-module thresholds via `[tool.coverage.report]` sub-config or a coverage plugin; not a bug. | Standalone CI optimization PR. |
| D4 | `whrb-web/instrumentation.ts` | `Sentry.flush(2000)` budget and client-side `tracesSampleRate: 0.05` are both serverless-flush guidance defaults, not measured-from-real-traffic values. | Need a week of real Vercel traffic to retune from the Sentry quota dashboard. | Re-tune one week post first prod deploy. |
| D5 | `whrb-prospects/sources/*` | 38 sources still emit `list[dict]`, only 3 migrated to `list[ProspectRow]` in PR #47. | Already explicit non-goal in the original plan. Type-only doc improvement; no runtime risk. | Roll up with whatever next touches each source. |

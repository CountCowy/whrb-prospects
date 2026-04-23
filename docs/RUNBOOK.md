# Runbook

Operator-facing reference for running, debugging, and rotating WHRB
Prospects in dev. Production playbook lives in `ROLLOUT_PROD.md`
(created at Stage 11 cutover, currently parked).

Audience: someone who needs to make the project work today — running a
local pipeline, reading event logs, rotating a key, recovering from a
failed migration. Architecture rationale is in
[`ARCHITECTURE.md`](ARCHITECTURE.md); schema reference in
[`DATA-MODEL.md`](DATA-MODEL.md).

---

## Local development

### Pipeline

```bash
cd whrb-prospects
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env  # then fill in Supabase + (optional) API keys
.venv/bin/python pipeline.py --dry --no-supabase
```

Required env vars (in `whrb-prospects/.env`):

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

Optional:

- `YELP_API_KEY` — without this the Yelp source returns [].
- `HUNTER_API_KEY` / `APOLLO_API_KEY` — free tiers; without them the
  enricher falls back to contact-page scraping only.
- `WHRB_VOCAB_STRICT=true` (T2+) — fail the run if any source emits a
  tag value not present in `tag_vocabulary`.

### Web app

```bash
cd whrb-web
pnpm install
cp .env.local.example .env.local  # fill in Supabase URL + anon key
pnpm dev
```

The dev server runs on http://localhost:3000. Magic-link emails arrive
in the Supabase dashboard's Auth → Logs view in dev (no SMTP needed).

### Supabase

The dev project is `WHRB dev` (`kolfijjavwruwzctmnlx`). The Supabase
CLI is not strictly required — the project applies migrations via
`whrb-prospects/scripts/apply_*.py` (psycopg2 over the direct DSN).

---

## Pipeline flags

| Flag | Effect |
|------|--------|
| `--dry` | Cap each source at ~5 rows. Skip expensive enrichment. |
| `--fresh` | Clear phase + source checkpoints. **Preserves** `cache/http_cache.sqlite`. |
| `--with-hic` | Include MA HIC source (~30k rows; slow). |
| `--with-bbb` | Include Better Business Bureau source (Playwright, flaky). |
| `--no-supabase` | Skip the `08_supabase_sync` phase. CSV still written. |
| `--resume` | Honor existing checkpoint (default — flag is informational). |

Standard production-style run:

```bash
.venv/bin/python pipeline.py --with-hic
```

Background invocation pattern (used by stage integrity scripts):

```bash
nohup .venv/bin/python pipeline.py --fresh --with-hic > cache/run.log 2>&1 &
```

CSV archival before `--fresh` reruns:

```bash
mv output/whrb_prospects.csv output/whrb_prospects_pre_$(date +%s).csv
```

---

## Phase failure → recovery

| Failed phase | Resume strategy |
|--------------|-----------------|
| 01_collected | Re-run; per-source checkpoint resumes the surviving sources. |
| 02_normalized | Re-run; deterministic from collected snapshot. |
| 03_deduped | Re-run; checkpointed. |
| 04_email_enriched | Re-run; per-row checkpointed. |
| 05_validated | Re-run; deterministic. |
| 06_scored | Re-run; cheap. |
| 07a_nonprofit | Re-run; IRS BMF cache 30d TTL. |
| 08_supabase_sync | Inspect `pipeline_runs.error`. Re-run safe (idempotent upserts). |

Truly broken state: archive CSV + run with `--fresh`.

---

## Supabase operations

### Apply a migration

```bash
cd whrb-prospects
.venv/bin/python scripts/apply_<stage>_migration.py
```

Each `apply_*.py` script wraps psycopg2 with pooler-then-direct DSN
fallback. Migrations are SQL files under `whrb-web/supabase/migrations/`.

### Roll back a migration

```bash
.venv/bin/python scripts/apply_t1_migration.py --rollback
```

Or apply the matching `NNN_rollback.sql` directly. See
[`ROLLBACK.md`](../ROLLBACK.md) for the recovery procedure.

### Read RLS policies

```bash
.venv/bin/python scripts/rls_check.py
```

Expected output: `20/20 PASS`. T1 does not extend the rls_check script
(tag tables get coverage in T2's plant + integrity).

### Service-role key rotation

1. Generate new key in Supabase dashboard (Settings → API).
2. Update `whrb-prospects/.env` and Vercel envs (web app + GitHub
   Actions repo secrets).
3. Restart the web app (Vercel re-deploy) and any background workers.
4. Re-run `scripts/rls_check.py` to confirm.

---

## Tests

### Pipeline

```bash
cd whrb-prospects
.venv/bin/python -m pytest tests/
```

### Stage integrity

```bash
cd whrb-prospects
.venv/bin/python scripts/<stage>_plant.py       # seed fixtures
.venv/bin/python scripts/<stage>_integrity.py   # run all Tks
.venv/bin/python scripts/<stage>_cleanup.py     # remove fixtures
```

### Web e2e

```bash
cd whrb-web
pnpm e2e                   # full suite
pnpm e2e --grep stage10c   # filter by stage
pnpm e2e --grep t1         # T1 (lands in this PR)
pnpm e2e:ui                # interactive UI
```

CI runs the same commands via `.github/workflows/whrb-web-ci.yml`.

---

## Event-log triage

Every stage exit:

```sql
select count(*) from event_log
 where level in ('error','fatal')
   and created_at > '<stage_start>';
```

Must equal `0`, or every survivor explicitly explained in the ROLLOUT
entry's whitelist.

Correlate a single pipeline run end-to-end:

```sql
select created_at, source, level, category, message
  from event_log
 where pipeline_run_id = '<run_uuid>'
 order by created_at;
```

Common failure patterns from prior stages:

| Symptom | Cause | Fix location |
|---------|-------|--------------|
| `AttributeError: 'dict' object has no attribute 'startswith'` | Socrata URL-type field | `util/normalize.py::normalize_website` |
| HSBA rows share contact info | Old website pointed to directory page | `sources/chambers.py::_scrape_hsba_detail` |
| Boston food floods output | No phone filter, wrong tier | `sources/city_licenses.py` (resolved Stage 3) |
| Audit trigger emits no event | Field not in `tracked` array | `000_init.sql::audit_prospect_change` |

T1-specific:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `tag_vocabulary` INSERT 23505 | Unique `(axis, value)` collision | Existing row; check status/replacement_id. |
| Vocab merge 400 with `code: P0002` | Cross-axis attempt | PATCH source axis first (plan §1.3 #22). |
| Rep tag-add notification not arriving | `notifications.kind` constraint | Confirm migration 007 ran (extends enum). |

---

## Key rotation table

| Key | Where stored | Rotation cadence | Procedure |
|-----|--------------|------------------|-----------|
| Supabase service role | `whrb-prospects/.env` + Vercel envs + GH Actions | On suspected leak | Dashboard → API → reveal new → propagate. |
| Supabase anon | `whrb-web/.env.local` + Vercel envs | Annual | Same. Public-safe. |
| Supabase JWT secret | Supabase dashboard | On suspected leak | Forces all sessions to re-auth. |
| `GH_DISPATCH_PAT` | GH Actions repo secret | Per token expiry (currently 2026-07-20) | Fine-grained PAT; needs `Contents: Read/write` + `Actions: Read/write`. |
| Yelp Fusion | `whrb-prospects/.env` | Annual | yelp.com/developers. |
| Hunter / Apollo | `whrb-prospects/.env` | Annual | Free-tier dashboards. |

---

## Stage 11 readiness memo (parked)

When the user says "start Stage 11":

1. Register the production domain (`sales.whrb.org` per plan).
2. Set up Resend account; generate sending domain DNS records;
   propagate.
3. Create the production Supabase project (separate from
   `kolfijjavwruwzctmnlx`).
4. Replay every committed migration in order against the prod project
   via `apply_*.py`.
5. Configure prod env vars on Vercel (production env, not preview).
6. Cut over Vercel deployment alias to the prod URL.
7. Invite the WHRB team via the prod Supabase Auth admin invite flow.
8. Spawn `ROLLOUT_PROD.md` and re-run every Stage 1–10c integrity
   script against prod (clean baseline).

Detailed sequencing in `~/.claude/plans/read-users-countcowy-claude-plans-soft-c-velvety-sonnet.md`
§2 decision 8 (local plan file).

---

## Incident playbooks

### Pipeline run fails mid-phase

- Phases 01–07a: re-run; checkpoints resume the surviving work.
- Phase 08 (supabase_sync): inspect `pipeline_runs.error`. Upserts are
  idempotent; safe to re-run. If the row count looks wrong, run a
  `postrun_check.py` diff to confirm the edit-lock matrix held.

### RLS regression detected

- Reproduce with `scripts/rls_check.py`. Failing assertions list the
  table + operation.
- Re-apply the migration that introduced the policy via
  `apply_<stage>_migration.py`.
- If the migration itself is wrong, follow [`ROLLBACK.md`](../ROLLBACK.md)
  to roll back, fix, re-apply.

### Vercel preview deploy fails

- Check Vercel build log for missing env var (most common: a new env
  added locally but not added to Vercel).
- Verify `whrb-web/lib/env.server.ts` is not imported from a client
  module — that triggers the `'server-only'` runtime guard.
- Verify `next.config.ts` matches the deployed runtime version.

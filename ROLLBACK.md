# Migration rollback procedure

Every numbered migration under `whrb-web/supabase/migrations/` ships
with a paired `NNN_rollback.sql` (convention introduced in T1). When a
migration fails partway, or a stage needs to revert a schema change,
follow this procedure.

The procedure assumes the dev project (`WHRB dev`,
`kolfijjavwruwzctmnlx`). For prod (Stage 11+), the same steps apply
with extra coordination — see the production-cutover memo in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md#stage-11-readiness-memo-parked).

---

## When to roll back

- Migration apply failed midway (e.g. `psycopg2.errors.SyntaxError`,
  partial DDL applied).
- Stage integrity discovers a schema regression that the migration
  caused.
- A stage needs to be retracted entirely.

**Do not roll back** for runtime data issues (those need a fix-forward
PR with a corrective migration). Rollback is for schema-shape
problems only.

---

## Procedure

1. **Capture the failure.**
   - Save the failing command + stack trace from `apply_*.py` output.
   - Pull the relevant `pg_stat_statements` / log entries from the
     Supabase dashboard (Database → Logs → Postgres logs).
   - Save them into the ROLLOUT entry under "Rollback context."

2. **Apply the matching rollback file.**
   ```bash
   cd whrb-prospects
   .venv/bin/python scripts/apply_t1_migration.py --rollback
   ```
   Or, if no per-stage script wraps the rollback, run the SQL
   directly:
   ```bash
   .venv/bin/python -c "
   import os, psycopg2
   from dotenv import load_dotenv
   load_dotenv('.env')
   dsn = (
       'postgresql://postgres:' + os.environ['SUPABASE_DB_PASSWORD'] +
       '@db.' + os.environ['SUPABASE_PROJECT_REF'] +
       '.supabase.co:5432/postgres?sslmode=require'
   )
   sql = open('../whrb-web/supabase/migrations/NNN_rollback.sql').read()
   with psycopg2.connect(dsn) as c, c.cursor() as cur:
       cur.execute(sql)
   print('Rollback applied.')
   "
   ```

3. **Re-run the prior stage's integrity script.**
   ```bash
   .venv/bin/python scripts/<prior-stage>_plant.py
   .venv/bin/python scripts/<prior-stage>_integrity.py
   .venv/bin/python scripts/<prior-stage>_cleanup.py
   ```
   All Tks must be green. If they're not, the rollback file itself is
   broken — escalate.

4. **Fix the migration.**
   Edit the broken `NNN_*.sql` (and its rollback if needed). Push as
   the same PR — never a "rollback PR" merged on top of a "fix PR".
   The convention is **one stage = one PR**.

5. **Re-apply.**
   ```bash
   .venv/bin/python scripts/apply_<stage>_migration.py
   ```
   Then the stage's integrity again. Once green, update ROLLOUT.md
   with the rollback narrative under "Plan deviations."

---

## Pre-merge gate

Every migration PR must pass this cycle locally before merge:

```bash
# Apply
.venv/bin/python scripts/apply_<stage>_migration.py

# Roll back
.venv/bin/python scripts/apply_<stage>_migration.py --rollback

# Re-apply (idempotence + rollback round-trip)
.venv/bin/python scripts/apply_<stage>_migration.py
```

If any step fails, the migration is not ready to merge.

---

## What rollback files contain

- All `DROP TRIGGER IF EXISTS` for triggers introduced in the
  migration.
- All `DROP FUNCTION IF EXISTS … CASCADE` for trigger / RPC functions.
- All `DROP TABLE IF EXISTS … CASCADE` for new tables (in dependency
  order — child tables before parents).
- All `ALTER TABLE … DROP CONSTRAINT IF EXISTS … / ADD CONSTRAINT …`
  to restore enum constraints to their pre-migration values.
- Anything else needed to leave the schema **byte-identical** to its
  state before the forward migration.

The rollback file is **not** for data — only schema. Data lost during
the forward migration cannot be recovered by the rollback file (use a
DB snapshot or PITR for that).

---

## Idempotence guarantees

Both the forward migration and the rollback file should use:

- `CREATE TABLE IF NOT EXISTS` / `DROP TABLE IF EXISTS`.
- `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`.
- `DROP TRIGGER IF EXISTS … ON …` before `CREATE TRIGGER`.
- `CREATE OR REPLACE FUNCTION` for functions.
- `ALTER TABLE … DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`.

This way both files can be run repeatedly without raising
`already-exists` / `does-not-exist` errors.

---

## T1 specifics

- Forward: `whrb-web/supabase/migrations/007_tag_schema.sql`
- Rollback: `whrb-web/supabase/migrations/007_rollback.sql`
- Wrapper script: `whrb-prospects/scripts/apply_t1_migration.py`
  (`--rollback` flag).
- The rollback restores `notifications.kind` to its 000_init.sql
  enum (no `tag_vocab_pending`).
- The rollback drops both new tables (`prospect_tags`,
  `tag_vocabulary`) and the three new functions
  (`audit_prospect_tag_change`, `on_rep_tag_vocab_insert`,
  `merge_tag_vocabulary`).

---

## 010 specifics (multi-email per prospect)

- Forward: `whrb-web/supabase/migrations/010_prospect_contact_emails.sql`
- Rollback: `whrb-web/supabase/migrations/010_rollback.sql`
- Wrapper script: reuse the generic `scripts/apply_migration.py`
  inline-SQL pattern from the procedure above; no per-stage wrapper.

### What forward does
- Creates `prospect_contact_emails` (child of `prospects`) plus three
  indexes (partial unique on primary, case-insensitive unique on
  `(prospect_id, lower(email))`, and a listing-order index).
- Adds `prospects.contact_email_count int not null default 0`.
- Backfills the new table from non-null, format-valid scalars
  (`source='legacy_scalar'`), reconciles the count column, and
  emits a `multi_email_backfill_skipped` event_log row enumerating
  any prospects whose existing scalar failed the new format/length
  CHECK. Those prospects also have their stale scalar NULL'd in the
  same step so the table view doesn't keep showing garbage.
- Installs five triggers (see the schema mirror at
  `whrb-prospects/db/schema.sql` for the full list) and one RPC
  (`set_primary_contact_email`).
- REPLACEs `audit_prospect_change()` to drop `'contact_email'` from
  its tracked array — email-level audit comes from `t_pce_audit`.

### What rollback does
- Drops the five 010 triggers, the four 010 functions, the
  `prospect_contact_emails` table (cascading its RLS policies), and
  the `prospects.contact_email_count` column.
- REPLACEs `audit_prospect_change()` back to its 000_init.sql shape
  (with `'contact_email'` in the tracked array).
- **Does not restore data** that was added to the join table after
  backfill (rep-added emails, pipeline-added emails). For dev
  environments only — production rollback would lose multi-email
  data that has no place in the single-scalar world. Use a Supabase
  PITR snapshot for production rollback.

### Watch-outs
- The forward migration is **one transaction**. If any step fails
  mid-flight, Postgres rolls back automatically; no manual cleanup
  needed.
- Order matters inside the file: backfill (section 3) runs before
  the new triggers exist, the audit rewrite (section 9) runs before
  the guard trigger is installed (section 10). The migration as
  written respects this order — do not reorder sections without
  re-checking the dependency map in the file's header.
- After rollback, any pipeline pod or Lambda still on the post-010
  code path will start writing to a now-missing `contact_email_count`
  column. Stage callers down before rolling back.

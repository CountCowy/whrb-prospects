# Data model

Formal schema reference for every table in the WHRB Prospects database.
Build sources: `whrb-web/supabase/migrations/000_init.sql` (Stage 1)
through `007_tag_schema.sql` (T1). The Python pipeline mirrors a subset
into `whrb-prospects/db/schema.sql` (read-only reference).

State as of T1 exit: 12 tables in `public` (10 core + 2 T1-new),
`prospect_tags` populated with **zero rows** (backfill is T2).

---

## Table list

### Core (Stage 1)

| Table | Purpose | T1 changes |
|-------|---------|------------|
| `profiles` | Extends `auth.users`. `role ∈ {admin, rep}`. | None |
| `prospects` | Master prospect row. Mirrors CSV columns + user fields. | None |
| `prospect_notes` | Soft-deleted note thread per prospect. | None |
| `source_config` | `/admin/sources` enable/disable per scraper. | None |
| `pipeline_runs` | Audit + queue for pipeline executions. | None |
| `event_log` | Unified cross-stream log. | T1 adds new categories: `vocab_created`, `vocab_updated`, `vocab_deleted`, `vocab_axis_changed`, `tag_merge`, `prospect_tag_added`, `prospect_tag_removed`. |
| `feedback` | Floating widget + admin triage. | None |
| `user_preferences` | Per-user notification toggles. | None |
| `notifications` | Recipient-scoped inbox; Realtime-backed. | T1 extends `kind` enum with `tag_vocab_pending`. |
| `prospect_presence` | Heartbeat rows for "viewing now" dots. | None |

### T1-new

| Table | Purpose |
|-------|---------|
| `tag_vocabulary` | Canonical tag enum, axis × value, with status + replacement chain. |
| `prospect_tags` | Many-to-many between prospects and vocab rows. Per-row lock. |

---

## `tag_vocabulary` (T1)

| Column | Type | Default | Note |
|--------|------|---------|------|
| `id` | uuid PK | `gen_random_uuid()` | |
| `axis` | text NOT NULL | — | One of 9: `sector`, `operating_model`, `genre`, `affiliation`, `cadence`, `daypart_fit`, `history`, `compliance`, `other`. |
| `value` | text NOT NULL | — | lower_snake_case identifier; unique within axis. |
| `status` | text NOT NULL | `'active'` | `active | pending_admin_review | deprecated`. |
| `replacement_id` | uuid FK | — | Points at successor row when status=`deprecated`. |
| `created_by` | uuid FK | — | NULL = system/seed; set = user. |
| `created_at` | timestamptz | `now()` | |
| `updated_at` | timestamptz | `now()` | Trigger-maintained via `set_updated_at`. |

**Indexes:** PK + `(axis, value)` UNIQUE + `(axis, status)`.

**RLS:** anon denied. Authed users SELECT all rows (regardless of status
— pending tags surface in the admin inbox). INSERT allowed for any
authed user (trigger forces `pending_admin_review` for non-admins).
UPDATE + DELETE admin-only.

**Triggers:**

- `t_tag_vocabulary_updated_at` — generic `set_updated_at`.
- `t_tag_vocabulary_rep_insert` → `on_rep_tag_vocab_insert`. For
  non-admin actors: forces `status='pending_admin_review'`, sets
  `created_by=auth.uid()` if not already, fans out a `notifications`
  row (kind=`tag_vocab_pending`) for every admin.

---

## `prospect_tags` (T1)

| Column | Type | Default | Note |
|--------|------|---------|------|
| `id` | uuid PK | `gen_random_uuid()` | |
| `prospect_id` | uuid FK NOT NULL | — | `ON DELETE CASCADE`. |
| `tag_id` | uuid FK NOT NULL | — | No `ON DELETE CASCADE` — prevents accidental tag-vocab churn. The admin DELETE route cascades manually. |
| `created_by` | uuid FK | — | NULL = pipeline; set = user. |
| `created_at` | timestamptz | `now()` | |
| `locked_by` | uuid FK | — | NULL = unlocked. |
| `locked_at` | timestamptz | — | |

**Indexes:** PK + `(prospect_id, tag_id)` UNIQUE + `(prospect_id)` +
`(tag_id)`.

**RLS:** anon denied. Authed users SELECT all. INSERT any authed.
DELETE / UPDATE: admin OR (`locked_by IS NULL`) OR (`locked_by =
auth.uid()`).

**Triggers:**

- `t_prospect_tags_audit` → `audit_prospect_tag_change`. Emits
  `prospect_tag_added` (INSERT) or `prospect_tag_removed` (DELETE)
  rows on `event_log` with `{prospect_id, tag_id, axis, value,
  actor_id}` context.

---

## RPCs

### `merge_tag_vocabulary(p_source_id uuid, p_target_id uuid) returns jsonb`

Same-axis merge of two vocab rows. Moves all `prospect_tags` from
source to target (handling unique-constraint collisions by dropping
the duplicate), then deletes the source vocab row. Returns
`{affected_prospect_count, collision_count, from_axis, from_value,
to_axis, to_value}`.

**Errors:**

- `P0001` — source or target id not found.
- `P0002` — cross-axis attempt (caller must change source's `axis`
  first per gleaming-dawn §1.3 #22).
- `P0003` — self-merge.

**Caller:** `app/api/admin/vocab/[id]/merge/route.ts`.

---

## JSONB shapes

### `prospects.user_overrides`

`{[field_name]: true}`. Per-field flag marking columns the user has
manually edited. The pipeline's `08_supabase_sync` skips upsert of any
column where this flag is `true`.

T1 leaves the lock matrix at 15 columns (state, assigned_to, tier,
company_name, company_phone, company_email, contact_name,
contact_email, contact_phone, website, is_nonprofit, nonprofit_source,
ein, priority_score, user_overrides). T3 adds per-tag locks via
`prospect_tags.locked_by` (separate column, not in this JSONB).

### `prospects.alt_fields`

`{[field_name]: alternate_value}`. Dedupe writes the loser's divergent
value here. The detail UI surfaces it as "Was previously…".

### `event_log.context`

Free-form JSONB; categories define the schema:

| Category | Context shape |
|----------|---------------|
| `prospect_state_change` | `{prospect_id, field, old, new, actor_id}` |
| `prospect_field_change` | same shape, `field` varies |
| `prospect_assignment_change` | same shape, `field='assigned_to'` |
| `vocab_created` (T1) | `{tag_id, axis, value}` |
| `vocab_updated` (T1) | `{id, changes: {…}}` |
| `vocab_axis_changed` (T1) | `{id, from_axis, to_axis, affected_prospect_count}` |
| `vocab_deleted` (T1) | `{id, axis, value}` |
| `tag_merge` (T1) | `{from_id, to_id, affected_count, collision_count}` |
| `prospect_tag_added` (T1) | `{prospect_id, tag_id, axis, value, actor_id}` |
| `prospect_tag_removed` (T1) | same shape |
| `dedupe_match` | `{winner_id, loser_id, score, reason}` |

T4 introduces `filter_impressions`, `vocab_axis_changed` aggregates,
and other instrumentation categories — see plan §6.

### `notifications.payload`

| Kind | Payload shape |
|------|---------------|
| `assigned`, `unassigned` | `{prospect_id, prospect_name}` |
| `note_mention` | `{prospect_id, note_id}` |
| `run_complete` | `{run_id, status, rows_upserted}` |
| `feedback_status` | `{feedback_id, new_status}` |
| `tag_vocab_pending` (T1) | `{tag_id, axis, value}` |

---

## Prospect state machine

7 states, 42 non-self transitions (any-state-to-any-state allowed,
including `dead → researching`):

```
researching ──► waiting_response ──► initial_contact ──► ongoing_contact
       │                │                  │                  │
       └──► dead ◄──────┴────────► sold ◄──┴──► previous_client
```

Every transition emits `event_log.category='prospect_state_change'`.
The kanban board at `/my` allows drag-drop between any pair.

---

## `business_key` derivation

In order:

1. `normalize_phone(company_phone)` if 10 digits remain.
2. `normalize_phone(contact_phone)` if 10 digits remain.
3. `slug(company_name)|zip` (lowercased, ASCII-folded, non-alphanumerics
   replaced with `_`).
4. `manual-{uuid}` for admin-added rows.

Implemented in `whrb-prospects/db/supabase_sync.py::_business_key`.
Reuses `enrich/dedupe.py::_norm_phone` and `::_norm_name` so the
key is stable across pipeline runs and matches the dedupe pre-merge.

---

## CSV → DB column map

`whrb-prospects/pipeline.py::CSV_COLUMNS` writes
`output/whrb_prospects.csv` after each pipeline run. Mapping:

| CSV column | DB column | Owner |
|------------|-----------|-------|
| `company_name` | `prospects.company_name` | pipeline |
| `website` | `prospects.website` | pipeline (lock-respect) |
| `company_phone` | `prospects.company_phone` | pipeline (lock-respect) |
| `company_email` | `prospects.company_email` | pipeline (lock-respect) |
| `contact_name` | `prospects.contact_name` | pipeline (lock-respect) |
| `tier` | `prospects.tier` | pipeline (lock-respect) |
| `priority_score` | `prospects.priority_score` | pipeline (lock-respect) |
| `pipeline_notes` | `prospects.pipeline_notes` | pipeline only |
| (rep-only — never in CSV) | `prospects.state` | rep |
| (rep-only — never in CSV) | `prospects.assigned_to` | rep |

`pipeline_notes` is intentionally distinct from the rep-editable
`prospect_notes` table — the column was renamed pre-Stage-2 to avoid
collision.

---

## Tier system

A / B / C — **price band only**. T1 leaves this unchanged
(gleaming-dawn §1.3 #2). The other two concepts the old `tier` column
overloaded (vertical, buyer type) move into the tag system: `sector`
covers vertical, `operating_model` covers buyer type.

| Tier | Package range | Typical sources |
|------|---------------|-----------------|
| A | $1,500 – $3,000 | Cultural anchors, premium retail, senior living. |
| B | $300 – $1,500 | Independent restaurants, boutiques, professional services. |
| C | $100 – $500 | Home-services contractors, long-tail. |

`config.SCORE_WEIGHTS` adds 30 / 15 / 5 to `priority_score` for A / B / C.

---

## Scoring

`priority_score` = sum of `config.SCORE_WEIGHTS` contributions:

| Signal | Weight |
|--------|-------:|
| `has_website` | 20 |
| `has_phone` | 10 |
| `has_contact_name` | 25 |
| `in_chamber` | 15 |
| `review_count_log` | 10 |
| `tier_A` | 30 |
| `tier_B` | 15 |
| `tier_C` | 5 |

Sort default on `/prospects` is `priority_score DESC` (server-side
indexed). T9 will reweight after ≥3 months of close-rate data
attribution from T5+ instrumentation.

---

## T2 forward note

- `prospect_tags` populates from a new `08b_tag_sync` phase.
- A new SQL function/view computes `daypart_fit` from
  `genre`/`sector`/`history` tags at read time.
- A new column `prospect_tags.suppressed_at timestamptz` (with
  `suppressed_by uuid`) lets reps "soft-clear" compliance tags
  without DELETE — pipeline re-emission becomes a no-op +
  `event_log.category='compliance_resuppressed'`.

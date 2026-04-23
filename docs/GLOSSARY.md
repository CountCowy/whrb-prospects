# Glossary

Project-specific vocabulary, alphabetised. Each entry is at most three
sentences and links to the authoritative source. If a term lacks a
canonical definition link, it lives only here for now — open a PR to
promote it into ARCHITECTURE.md or DATA-MODEL.md.

---

**`alt_fields`** — JSONB on `prospects`. Alternate values preserved by
dedupe merges (the loser's divergent value lands here under the same
key). See [DATA-MODEL.md → JSONB shapes](DATA-MODEL.md#jsonb-shapes).

**`assigned_to`** — FK on `prospects` pointing at `profiles.id`. The
rep who owns a prospect; assignment changes emit
`prospect_assignment_change` events.

**`axis`** — One of nine top-level tag dimensions
(`sector`, `operating_model`, `genre`, `affiliation`, `cadence`,
`daypart_fit`, `history`, `compliance`, `other`). Stored on
`tag_vocabulary.axis`. See [`TAGS.md`](../TAGS.md).

**`business_key`** — Dedupe key on `prospects`. Phone-first, name+zip
fallback. Defined in `whrb-prospects/db/supabase_sync.py::_business_key`.
See [DATA-MODEL.md → business_key derivation](DATA-MODEL.md#business_key-derivation).

**`checkpoint`** — On-disk JSON state file used by the pipeline to
resume between phases (24h TTL). Located in `whrb-prospects/cache/`.

**`compliance` (axis)** — Tag axis for FCC / brand-safety constraints.
Cannabis is a hard pipeline block, not a compliance tag (plan §1.3 #6).
See [`TAGS.md`](../TAGS.md).

**`daypart`** — A WHRB programming slot (Classical, Jazz, Blues,
Hillbilly at Harvard, Record Hospital, The Darker Side, etc.). The
`daypart_fit` tag axis is **derived** at read time in T2 from the other
axes via a SQL view. **Not used in rep-facing copy** per
gleaming-dawn §1.3 #14 — render program names directly.

**`dispatch`** — A pipeline run initiated via GitHub Actions
`repository_dispatch` (admin-triggered from `/admin/runs` or via the
twice-monthly cron).

**`emitter`** — A function in a `whrb-prospects/sources/*.py` module
that emits a tag dict for a row. T2 ships the first emitters; T1
defines the vocab they will reference.

**`enrichment`** — Pipeline phase 04 + module set in
`whrb-prospects/enrich/`. Adds contact name, phone, email via Hunter,
Apollo, and `/contact` / `/about` page scraping.

**`event_log`** — Unified log table receiving rows from all three
streams (Python pipeline, Next.js server, browser). See
[ARCHITECTURE.md → Event logging](ARCHITECTURE.md#event-logging).

**`fixture`** — Synthetic seed data used by stage integrity scripts.
Owned by `scripts/<stage>_plant.py` (idempotent insert) and
`scripts/<stage>_cleanup.py` (idempotent removal).

**`hash-token fallback`** — Auth flow used when admin-invited users
follow magic links that arrive with `#access_token=` URL fragments.
The browser-side handler upgrades the fragment to a session cookie.

**`integrity script`** — Per-stage `scripts/<stage>_integrity.py`
harness that runs every `Tk` check from the plan and reports
pass/fail. Stage exit requires all green.

**`lock` / `lock matrix`** — Two distinct mechanisms.
- **Per-field lock** on `prospects` via `user_overrides` JSONB —
  pipeline upserts skip locked columns. 15 fields total; verified by
  `scripts/stage7_lock_matrix.py`.
- **Per-tag lock** on `prospect_tags.locked_by` (T1) — pipeline DELETE
  and cross-user DELETE blocked when locked.

**`magic-link`** — Supabase passwordless auth flow. PKCE in normal
sign-in; hash-token fallback for admin invites.

**`merge_tag_vocabulary`** — Postgres RPC (T1) that merges two
same-axis vocab rows. Cross-axis merges raise `P0002` and the API
translates to HTTP 400. See
[DATA-MODEL.md → RPCs](DATA-MODEL.md#rpcs).

**`phase`** — One of the eight pipeline phases (01_collected through
08_supabase_sync; T2 adds 08b_tag_sync). See
[ARCHITECTURE.md → Pipeline phases](ARCHITECTURE.md#pipeline-phases).

**`pipeline_run_id`** — UUID on every `event_log` row that ties events
to a single `pipeline_runs` row. CLI runs and dispatch runs both stamp
it. Enables single-run drilldown at `/admin/runs/[id]`.

**`PKCE`** — Proof-key-for-code-exchange. The OAuth 2.0 extension
Supabase uses to bind the magic-link code redemption to the originating
browser session.

**`plant / cleanup`** — A pair of stage-specific scripts that
respectively seed and remove fixture data. Idempotent so a re-run
leaves the same shape.

**`preflight`** — Informal term for the regression check at the start
of each new stage: re-run the previous stage's integrity script to
confirm a clean baseline.

**`priority_score`** — Integer on `prospects`. Sum of weighted signals
from `config.SCORE_WEIGHTS`. Default sort on `/prospects` is
`priority_score DESC`.

**`prospect`** — A candidate sponsor / advertiser, represented as one
row in the `prospects` table.

**`prospect_tags`** — T1-new join table between `prospects` and
`tag_vocabulary`. Many-to-many with per-row lock. See
[DATA-MODEL.md → prospect_tags](DATA-MODEL.md#prospect_tags-t1).

**`RLS`** — Row-Level Security. Postgres-native authorisation that
gates every query by the connecting role. WHRB enables RLS on every
`public` table; the service-role key bypasses it for the pipeline,
but **never** for the web app.

**`RSC`** — React Server Component. Default rendering mode for
`whrb-web/app/`; forces the developer to opt in to client interactivity
with `'use client'`.

**`run`** — One pipeline execution. Row in `pipeline_runs` with
`status ∈ {queued, running, success, failed}`.

**`signal area`** — The geographic ring where WHRB's broadcast is
reliable. Stored as `WHRB_ZIPS` + `WHRB_BBOX` in
`whrb-prospects/config.py`. T1 widened to the media kit's "Distant"
ring.

**`source`** — One module under `whrb-prospects/sources/`. Each emits
rows in a normalised shape; the dedupe phase merges duplicates across
sources. Listed in [ARCHITECTURE.md → Data sources](ARCHITECTURE.md#data-sources).

**`source_config`** — Postgres table backing `/admin/sources`. Lets
admins enable/disable scrapers between runs without redeploying the
pipeline.

**`stage`** — A rollout milestone. Stages 1–10c are the original
foundation track from `soft-crafting-tulip.md` /
`read-users-countcowy-claude-plans-soft-c-velvety-sonnet.md`. Stages
T1–T8 are the post-10c epic from `gleaming-dawn.md`.

**`tag_vocab_pending`** — `notifications.kind` value (T1) emitted when
a non-admin authed user inserts a `tag_vocabulary` row. Triggers the
admin moderation inbox.

**`tag_vocabulary`** — T1-new canonical tag enum. Axis × value with
status + replacement chain. See
[DATA-MODEL.md → tag_vocabulary](DATA-MODEL.md#tag_vocabulary-t1).

**`tier`** — A / B / C price band on `prospects`. Decoupled from
sector and buyer-type concerns in T1 (those move to the tag system).
Unchanged by T1 itself.

**`underwriting`** — FCC framework noun. Used in legal / process
contexts only; **not** as the buyer noun. The buyer is an "advertiser"
or "sponsor". See [`TERMINOLOGY.md`](../TERMINOLOGY.md).

**`user_overrides`** — JSONB on `prospects`. Per-field flag matrix
marking columns the user has manually edited; respected by the pipeline
sync. See [DATA-MODEL.md → JSONB shapes](DATA-MODEL.md#jsonb-shapes).

**`vocab` / `vocabulary`** — Shorthand for `tag_vocabulary`. The admin
UI lives at `/admin/vocab`.

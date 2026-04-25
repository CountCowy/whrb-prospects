# TAGS — canonical tag vocabulary

This file is the **single source of truth** for the seeded `tag_vocabulary`
rows. The seed script
([whrb-web/supabase/seed_tags.sql](whrb-web/supabase/seed_tags.sql)) and
the integrity test
([whrb-prospects/scripts/t1_integrity.py](whrb-prospects/scripts/t1_integrity.py))
both compare against the row counts here. **If you add or remove a tag
below, update the seed in the same commit.** If a value is in the seed but
not here, that's a bug.

Convention: `<axis>:<value>` everywhere `axis:value` syntax is needed. The
DB stores `axis` and `value` as separate columns; the colon notation is a
display-layer convenience (chips, plan text, `event_log.context`).

The 9 axes were locked in
[gleaming-dawn.md §1.3 #3](../.claude/plans/users-countcowy-downloads-media-kit-202-gleaming-dawn.md).
Note: `daypart_fit` is **derived** at read time from the other axes (T2
ships the SQL view); the vocab rows below exist so the view can reference
them without a chicken-and-egg migration ordering.

---

## Axes (9)

| Axis | Purpose | Seeded values | Notes |
|------|---------|---------------|-------|
| `sector` | What industry the prospect is in | 11 + `unknown` | Multi-value allowed; e.g. arts + nonprofit. |
| `operating_model` | How the prospect operates / sells | 7 + `unknown` | Single-value typical, but multi-allowed. |
| `genre` | Music / programming category for arts prospects | 13 + `unknown` | Drives `daypart_fit` derivation in T2. |
| `affiliation` | Geographic / institutional anchor | 10 + `unknown` | Five metro values + 5 outer rings. |
| `cadence` | When in the calendar a prospect buys | 8 + `unknown` | Powers seasonal-outreach scheduling. |
| `daypart_fit` | Which WHRB program slot fits | 6 + `unknown` | **Derived** in T2 from `genre`/`sector`/etc. Vocab seeded now. |
| `history` | Prior advertiser behaviour signal | 8 + `unknown` | Peer-station sponsorships + program-book history + cert programs. |
| `compliance` | FCC / brand-safety constraint | 1 + `unknown` | Cannabis is a hard pipeline block, not a tag (plan §1.3 #6). |
| `other` | Catch-all for rep-created tags | 0 + `unknown` | Populated organically via the `tag_vocab_pending` flow. |

`unknown` exists in every axis (9 rows) so scrapers can express "we know
the axis applies but couldn't determine the value."

---

## Values

### `sector` (11 + unknown = 12)

`arts`, `nonprofit`, `education`, `home_services`, `religious`, `finance`,
`medical`, `retail`, `technology`, `hospitality`, `real_estate`,
`unknown`.

### `operating_model` (7 + unknown = 8)

`ensemble`, `presenter`, `venue`, `festival`, `service_provider`,
`retailer`, `institution`, `unknown`.

### `genre` (13 + unknown = 14) — gleaming-dawn §1.3 #5

`classical`, `choral`, `opera`, `jazz`, `world_music`, `folk`, `blues`,
`country`, `rock_indie`, `dance`, `theatre`, `film`, `spoken_word`,
`unknown`.

Genre collapses agreed in §1.3 #5: `baroque` / `chamber` / `early_music`
all map to `classical`; `country` and `blues` both map to
`daypart_fit:blues_hillbilly` (Hillbilly at Harvard is old-time country
programming).

### `affiliation` (10 + unknown = 11) — gleaming-dawn §1.3 #4

`harvard_affiliated`, `mit_affiliated`, `cambridge_based`, `boston_based`,
`greater_boston`, `berkshires`, `cape_ann`, `new_england_regional`,
`national`, `international`, `unknown`.

`greater_boston` absorbs Somerville / Brookline / Watertown / Arlington /
Belmont / Newton.

### `cadence` (8 + unknown = 9)

`term_driven`, `year_round`, `admissions_window`, `seasonal_spring`,
`seasonal_summer`, `seasonal_fall`, `seasonal_winter`, `move_window`,
`unknown`.

### `daypart_fit` (7 + unknown = 8)

`classical`, `jazz`, `blues_hillbilly`, `record_hospital`, `darker_side`,
`sports_news`, `multi_daypart`, `unknown`.

`daypart_fit` is **derived** from other axes in T2 via a SQL function. The
chip rendering layer prefixes values with `daypart_` for display
(`daypart_classical`, `daypart_blues_hillbilly`, etc.) — that's a UI
convenience, the DB stores the unprefixed value here.

`multi_daypart` is a sentinel emitted when a prospect's tags say
`sector='media' + operating_model='distributor'` — cross-format media
distributors that fit any block. Seeded by `008_daypart_view.sql` rather
than the T1 canonical seed (added retroactively after the T2 review).

### `history` (8 + unknown = 9)

`wcrb_sponsor`, `wgbh_sponsor`, `wbur_sponsor`, `wumb_sponsor`,
`wers_sponsor`, `peer_public_radio`, `program_book_sponsor`,
`hpin_certified`, `unknown`.

### `compliance` (1 + unknown = 2)

`political`, `unknown`.

Cannabis is a **hard pipeline block** (plan §1.3 #6) and is intentionally
absent. T2+ source emitters add other compliance categories (alcohol,
gambling, etc.) when their fixture data forces the issue.

### `other` (0 + unknown = 1)

Just `unknown`. Rep-created tags via `TagAddDialog` (T3) land here when no
existing axis fits. Each rep-add fires the `tag_vocab_pending` notification
flow; admin approval re-axises if appropriate.

---

## Total seeded rows

| Axis | Count |
|------|------:|
| sector | 12 |
| operating_model | 8 |
| genre | 14 |
| affiliation | 11 |
| cadence | 9 |
| daypart_fit | 8 |
| history | 9 |
| compliance | 2 |
| other | 1 |
| **Total** | **74** |

T1's integrity test `T01` accepts `count = 73` (pre-T2-migration) or
`count = 74` (post-T2-migration, after `008_daypart_view.sql` seeds
`daypart_fit:multi_daypart`). The original T1 seed produces exactly 73
active rows; T2's review-pass migration adds the one `multi_daypart`
sentinel for the `media + distributor` daypart rule.

---

## Forward-looking notes

- **T2 source emitters** will introduce additional values (especially in
  `sector`, `operating_model`, `cadence`, `compliance`). Each emitter ships
  with vocab additions — see `bin/emitted-vocab.py` for the diff check.
- **T3 rep UI** lets reps create new vocab in any axis. Rep-added values
  enter as `status='pending_admin_review'`; admin promotes via
  `/admin/vocab`.
- **Cross-axis migrations** (e.g. moving `sector:medical` → `sector:healthcare`)
  follow the two-step flow per plan §1.3 #22: PATCH the source axis to match
  the target axis first, then merge. The `merge_tag_vocabulary` RPC enforces
  same-axis only.

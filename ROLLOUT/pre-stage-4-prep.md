# Pre-Stage-4 prep (2026-04-18, post-Stage-3)

Captured per plan round-8 clarifications addendum. Logged here so the Stage 4 entry state is explicit. Nothing below has been executed yet — it records the agreed-upon entry plan.

- **Branch:** `stage4/nonprofit-enrichment` forks from `stage3/idempotent-rerun`.
- **New phase slot:** `07a_nonprofit` inserted in `pipeline.py::PHASE_ORDER` between `07_validated` and `08_supabase_sync`.
- **Pipeline schema changes:**
  - `pipeline.py::CSV_COLUMNS` gains `is_nonprofit`, `ein`, `nonprofit_source` (CSV/DB parity).
  - `db/supabase_sync.py::SCRAPED_FIELDS` gains `is_nonprofit`, `nonprofit_source`, `ein` so `user_overrides` can lock them. Without this, the Stage 4 manual-override test cannot pass.
- **New module:** `whrb-prospects/db/nonprofit_bmf.py` — downloads `https://www.irs.gov/pub/irs-soi/eo_ma.csv` into `cache/irs_bmf_ma.csv` (30-day TTL), emits `category='bmf_download' level='info'` on network hit only, runs suffix-tolerant name matching, stamps `is_nonprofit=true`/`ein=<NN-NNNNNNN>`/`nonprofit_source='irs_bmf'` on matched rows.
- **Suffix-tolerant matching:** normalize both sides with `_norm_name`, additionally strip a curated `_STRIP_TOKENS` set (`INC`, `CORP`, `LLC`, `LTD`, `CO`, `COMPANY`, `TRUST`, `TRUSTEES OF`, `THE`, `FOUNDATION`, `FUND`, `ASSOCIATION`, `SOCIETY`, `MUSEUM OF`, …). Tuned to hit canonical Tier-A spot-checks (MFA, BSO, Handel & Haydn, Isabella Stewart Gardner, Boston Ballet) without for-profit false positives. Conservative list — expand only if a spot-check legitimately fails.
- **Integrity script:** `scripts/stage4_integrity.py` in the same shape as stages 1–3.
- **DB pre-state:** trusted from Stage 3 exit record (2,933 distinct business_keys, event_log clean, stage3 fixtures torn down). No empirical re-verification before Stage 4 starts.
- **Pre-rerun archival:** `output/whrb_prospects.csv` → `output/whrb_prospects_4.csv` **before** the full rerun so the Stage 3 snapshot is retained.
- **Run mode:**
  - Run #1 (ingest + first BMF pass): `python pipeline.py --fresh --with-hic`, launched via Bash `run_in_background=true` to avoid the 10-min foreground timeout; output monitored via `cache/stage4_run1.log` polling.
  - Run #2 (cache-freshness check): plain `python pipeline.py` (no flags) resuming from Run #1's checkpoints. Logged to `cache/stage4_run2.log`. Integrity asserts zero `category='bmf_download'` events in this run's window.
- **Suffix-token expansion policy:** `db/nonprofit_bmf.py::_STRIP_TOKENS` starts conservative. If a canonical Tier-A spot-check fails to match, expand the list in-session and retry. Every expansion (what was added, which spot-check required it) is appended to this ROLLOUT.md entry when the stage is written.
- **Schema:** no migration. Existing `nonprofit_source in ('irs_bmf','propublica','manual')` constraint already covers Stage 4.
- **Commit + push:** one consolidated commit on `stage4/nonprofit-enrichment` after every integrity test is green; push to the existing remote on the same branch is permitted once all tests pass. No `Co-Authored-By: Claude` trailer.
- **Exit expectations** (plan Stage 4):
  - ≥ 50 rows with `is_nonprofit=true AND nonprofit_source='irs_bmf'`.
  - All five canonical nonprofits flagged with valid EINs.
  - Five for-profit spot-checks remain `is_nonprofit` false or null.
  - Manual override persists a rerun.
  - EIN format check `\d{2}-\d{7}` → 0 violations.
  - Cache freshness: rerun emits no `category='bmf_download'` event.

---


# WHRB prospects — `dev` rollout log

Per-stage integrity test results against the `WHRB dev` Supabase project
(`https://kolfijjavwruwzctmnlx.supabase.co`). Production cutover (Stage 11)
creates a separate `ROLLOUT_PROD.md`.

Plan: `/Users/countcowy/.claude/plans/soft-crafting-tulip.md`.

---

## Index

| # | Section | File |
|---|---|---|
| 1 | Stage 1 — Cloud provisioning + schema | [`stage-1.md`](./stage-1.md) |
| 2 | Pre-Stage-2 prep (2026-04-17, post-Stage-1) | [`pre-stage-2-prep.md`](./pre-stage-2-prep.md) |
| 3 | Stage 2 — Pipeline sync + event logging (2026-04-18) | [`stage-2.md`](./stage-2.md) |
| 4 | Stage 3 — Idempotent rerun (2026-04-18) | [`stage-3.md`](./stage-3.md) |
| 5 | Pre-Stage-4 prep (2026-04-18, post-Stage-3) | [`pre-stage-4-prep.md`](./pre-stage-4-prep.md) |
| 6 | Stage 4 — Nonprofit BMF enrichment (2026-04-18 → 2026-04-19) | [`stage-4.md`](./stage-4.md) |
| 7 | Pre-Stage-5 prep (2026-04-19, post-Stage-4) | [`pre-stage-5-prep.md`](./pre-stage-5-prep.md) |
| 8 | Stage 5 — Next.js skeleton + auth + theming + logging (2026-04-19) | [`stage-5.md`](./stage-5.md) |
| 9 | Stage 5.5 — whrb-prospects code-quality baseline (2026-04-19) | [`stage-5.5.md`](./stage-5.5.md) |
| 10 | Pre-Stage-6 prep (2026-04-19, post-Stage-5.5 / post-Stage-6a) | [`pre-stage-6-prep.md`](./pre-stage-6-prep.md) |
| 11 | Stage 6 — Read-only views + shared data grid + feedback widget (2026-04-20) | [`stage-6.md`](./stage-6.md) |
| 12 | Pre-Stage-7 prep (2026-04-20, post-Stage-6) | [`pre-stage-7-prep.md`](./pre-stage-7-prep.md) |
| 13 | Stage 7 — Editing, assignment, notes, Activity tab, kanban (2026-04-20) | [`stage-7.md`](./stage-7.md) |
| 14 | Pre-Stage-8 prep (2026-04-20, post-Stage-7) | [`pre-stage-8-prep.md`](./pre-stage-8-prep.md) |
| 15 | Stage 8 — Re-run idempotency with real user edits (2026-04-20 → 2026-04-21) | [`stage-8.md`](./stage-8.md) |
| 16 | Pre-Stage-9 prep (2026-04-21) | [`pre-stage-9-prep.md`](./pre-stage-9-prep.md) |
| 17 | Stage 9 — Admin console (2026-04-21) | [`stage-9.md`](./stage-9.md) |
| 18 | Pre-Stage-10b prep (2026-04-21) | [`pre-stage-10b-prep.md`](./pre-stage-10b-prep.md) |
| 19 | Stage 10b — Polish: presence, notifications, bulk, export, mobile (2026-04-22) | [`stage-10b.md`](./stage-10b.md) |
| 20 | Pre-Stage-10c prep (2026-04-22, post-Stage-10b merge) | [`pre-stage-10c-prep.md`](./pre-stage-10c-prep.md) |
| 21 | Stage 10c — Run controls + bulk selection + feedback scope fix (2026-04-22) | [`stage-10c.md`](./stage-10c.md) |
| 22 | Stage T1 — Foundation: terminology, signal-area, tag schema, admin vocab CRUD (2026-04-22) | [`stage-t1.md`](./stage-t1.md) |
| 23 | UI foundation PR — shadcn + warm palette + Command Palette (2026-04-23) | [`ui-foundation-pr.md`](./ui-foundation-pr.md) |
| 24 | UI verification infra PR — pre-push gate + /verify-ui + /review-ui (2026-04-24) | [`ui-verification-infra-pr.md`](./ui-verification-infra-pr.md) |
| 25 | Stage T2 — Tag emitters, cannabis block, backfill, daypart view (2026-04-24) | [`stage-t2.md`](./stage-t2.md) |
| 26 | Stage T3 — Rep tag UI: chips, filters, lock, clear, notifications, undo (2026-04-25) | [`stage-t3.md`](./stage-t3.md) |
| 27 | Stage T4 — Instrumentation, dashboard delta tiles, /media-kit, /guide, /changelog (2026-04-26) | [`stage-t4.md`](./stage-t4.md) |
| 28 | Schedule feature review pass (2026-04-27) | [`schedule-feature-review-pass.md`](./schedule-feature-review-pass.md) |
| 29 | Stage T5 — Competitor-station sponsor source (observation mode) (2026-04-28) | [`stage-t5.md`](./stage-t5.md) |
| 30 | Stage T6 — Harvard + ensemble + corporate-sponsor source batch (2026-04-28) | [`stage-t6.md`](./stage-t6.md) |
| 31 | Stage T7 — Open-data + regional expansion + trade associations (2026-04-30) | [`stage-t7.md`](./stage-t7.md) |
| 32 | Post-T7 tech-debt sweep — ROLLOUT shard, source typing, Sentry, coverage 70% (2026-05-01 → 2026-05-02) | [`post-t7-tech-debt-sweep.md`](./post-t7-tech-debt-sweep.md) |

Add new sections as `ROLLOUT/<slug>.md` and append a row above.

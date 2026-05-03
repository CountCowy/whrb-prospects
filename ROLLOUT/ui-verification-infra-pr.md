# UI verification infra PR — pre-push gate + /verify-ui + /review-ui (2026-04-24)

Post-UI-foundation infra PR that lands between `ui/foundation` merge and
T2 branching. Branch `infra/ui-verification-gates` off `main`
(post-UI-foundation tip). Not an official T-stage. Full spec in
`~/.claude/plans/ui-verification-infrastructure.md`. PR
[#23](https://github.com/CountCowy/whrb-prospects/pull/23) is **open**
at the time of this entry; merge pending explicit user command. This
entry is placed on the infra tip so it carries through on merge.

Context: five bugs landed on `ui/foundation` that `pnpm build` +
existing CI could not catch (hero tile 2×2 grid-span misplacement, Nav
icons missing, hero gradient double-alpha collapse, ColumnVisibilityMenu
Radix Checkbox-in-label regression, NotificationBell shadcn cva icon
cascade). This PR wires three independent forcing functions — pre-push
hook, `/verify-ui` skill, `/review-ui` skill — so that a UI-touching
push cannot succeed without (a) screenshots captured by an independent
puppeteer runner, (b) a review agent confirming zero critical/high
findings, and (c) neither bypass silently or via a hand-written
manifest.

### Artifacts produced

**Commit 1 (`chore: gitignore + .claude skeleton`)** — 722c946
- `.gitignore` — narrow the blanket `.claude/` ignore to carve out
  hook/skill/test source; add `.ui-verified.json`,
  `.review-clean.json`, `.claude/screenshots/` as regenerated-per-
  session artifacts.
- `.claude/hooks/helpers/changed-ui-files.sh` — prints UI-affecting
  files changed vs. `origin/main` (plus staged/unstaged), dedup'd.
  Globs + exclusions per plan §5.
- `.claude/hooks/helpers/all-authed-routes.json` — hardcoded authed
  route list (15 static + `/prospects/:id` resolved at runtime).
  Replaces the per-file route map from the r1 draft; any UI diff
  triggers the full route sweep (plan §6, r2 change).
- `.claude/hooks/helpers/probes.json` — interactive probes per route:
  `/prospects` (columnmenu-open, addprospect-open, filterbar-state),
  `/my` (kanban-view), `/` (command-palette, notification-bell-open,
  feedback-modal). Closes the triggered-state gap for three of the
  five historical bugs.
- `.claude/hooks/helpers/run-verify.mjs` — runner skeleton at this
  commit; filled in at commit 3.
- `~/.claude/audit/Listing/` bootstrap directory (outside worktree —
  survives cleanups, no git noise per plan §11 r2).
- No hook wiring yet.

**Commit 2 (`feat: pre-push gate hook + settings`)** — 038cff3
- `.claude/hooks/ui-pre-push-gate.sh` — PreToolUse script. Filters
  `tool_input.command` for `git push` (Bash) and acts on the four
  `mcp__github__*` push/merge verbs. Early-exit on non-push Bash; no-
  op on empty UI diff. Freshness check (`timestamp` within 15 min +
  `files_covered ⊇ current UI diff`) + independent screenshot-
  integrity check (PNG magic bytes, size ≥ 50 KB, sha256 match,
  mtime ±60 s) + observations-coverage check (one entry per
  route×theme×probe, ≥ 3 notes each). Bypass via `UI_VERIFY_SKIP=1`
  writes to `~/.claude/audit/<repo>/verify-skipped.log` with
  timestamp + sha + file list. Landed in diagnostic mode
  (`UI_VERIFY_MODE=diagnostic` env) — prints denial reasons but still
  allows the push. Flip to enforce lands in commit 5.
- `.claude/settings.json` — extends existing `permissions` block
  with `hooks.PreToolUse[]` entries matching `Bash` and
  `mcp__github__(create_pull_request|update_pull_request_branch|push_files|merge_pull_request)`.
  Adds `env.UI_VERIFY_MODE = "diagnostic"`.
- `.claude/hooks/test/pre-push-gate.bats` — 11 bats scenarios
  covering plan §14.1 A–J (empty diff; missing manifest; stale
  manifest; coverage gap; screenshot missing; sha mismatch; empty
  observations; <3 notes; no review-clean; all-fresh → allow;
  SKIP=1 → audit). **11/11 ok.**

**Commit 3 (`feat: /verify-ui skill + puppeteer runner`)** — a9cd2fd
- `.claude/hooks/helpers/run-verify.mjs` — completed. ~300 LOC.
  Reads `whrb-web/.env.local` for Supabase service-role key +
  `VERIFY_DEV_EMAIL`. Mints a magic-link token via
  `supabase.auth.admin.generateLink`. Launches puppeteer, navigates
  the link, waits for auth cookie. Iterates `all-authed-routes.json`
  × `{light, dark}` × probes; screenshots to
  `.claude/screenshots/<sha>/<slug>-<theme>[-<probe>].png`; computes
  `sha256(file)` for each; writes `.ui-verified.json` with `routes[]`
  populated + `observations: []` placeholder. `--dry-run` prints the
  resolved route×theme×probe matrix without launching puppeteer.
  Exits non-zero with structured error on missing env / auth fail /
  pnpm-dev-down / puppeteer crash.
- `.claude/skills/verify-ui/SKILL.md` — skill frontmatter
  (model-invokable; `allowed-tools: Bash Read Edit`). Five-step
  workflow: ensure `pnpm dev` on :3000; run the runner; Read every
  captured PNG (images enter context via `Read`, not markdown refs);
  look for defects (checklist keyed to the five historical bugs);
  Edit observations into `.ui-verified.json`; summarize.
- `whrb-web/package.json` — `puppeteer` added as `devDependency`
  (direct pin; avoids Playwright-rewrite coupling).

**Commit 4 (`feat: /review-ui skill + audit-prompt sibling`)** — 47bf6d7
- `.claude/skills/review-ui/SKILL.md` — frontmatter
  (`disable-model-invocation: true` — user-invoked only; avoids
  speculative agent spawns on unrelated edits; hook→skill flow is
  hook-deny → Claude-reads-reason → Claude-types-`/review-ui`).
  Steps: run `changed-ui-files.sh`; read sibling `audit-prompt.md`;
  spawn `general-purpose` subagent with the prompt + file list;
  parse `=== FINDINGS-JSON-START/END ===` via `parse-findings.sh`;
  write `.review-clean.json` only when `critical + high == 0`.
- `.claude/skills/review-ui/audit-prompt.md` — cleaned-up version of
  the audit prompt that caught the three bugs the foundation review
  missed (hero-gradient double-alpha, Checkbox-in-label, icon
  cascade). Severity rubric, 10 bug categories, required output
  format with sentinel markers.
- `.claude/hooks/helpers/parse-findings.sh` — awk-based extractor
  between the `FINDINGS-JSON-START`/`END` markers; emits per-
  severity counts + raw JSON to stdout; exits non-zero on malformed
  input (no partial manifest written).
- `.claude/hooks/test/parse-findings.bats` — 6 scenarios: well-
  formed clean; well-formed with critical; missing START; missing
  END; malformed JSON inside; no markers at all. **6/6 ok.**

**Commit 5 (`feat: activate pre-push deny path + rollout docs`)** —
1993a6f
- `.claude/settings.json` — `UI_VERIFY_MODE` flipped from
  `diagnostic` to `enforce`. The hook now emits
  `permissionDecision: "deny"` on every failure path (was: printed
  diagnostic + allowed).
- `docs/UI-VERIFICATION.md` — operator doc. Decision matrix (what
  triggers the gate; how to satisfy it); manual-run flow; emergency
  bypass + audit trail locations; extension points (adding routes /
  globs / audit categories); testing suites (pre-push-gate.bats,
  parse-findings.bats, /verify-ui cold run).
- `README.md` — new row in the how-to table pointing at the above
  doc.

### Verification

| Gate | Result |
|---|---|
| `bats .claude/hooks/test/pre-push-gate.bats` (against enforce mode) | 11/11 ok |
| `bats .claude/hooks/test/parse-findings.bats` | 6/6 ok |
| `/verify-ui` cold run on `infra/ui-verification-gates` tip (1993a6f) | 44 captures across 15 routes × (light, dark) + 7 probes; every PNG passed magic-byte + size + sha + mtime checks; manifest accepted by the hook |
| Historical replay merge-gate (plan §14.4, r3 recipe): 5 scratch branches off the infra tip, each surgically reintroducing exactly one bug | 5/5 denied with the expected reason ([#23](https://github.com/CountCowy/whrb-prospects/pull/23) body records per-branch evidence) |
| `replay/hero-2x2` (grid-span misplacement) | denied by `/verify-ui` screenshot review |
| `replay/nav-icons` (icons missing) | denied by `/verify-ui` screenshot review |
| `replay/hero-gradient` (double-alpha collapse) | denied by `/verify-ui` screenshot review |
| `replay/columnmenu-label` (Checkbox-in-label) | denied by `/review-ui` agent finding |
| `replay/bell-icon` (cva icon cascade) | denied by `/review-ui` agent finding |
| `pnpm build` + `pnpm lint` + `pnpm typecheck` on infra tip | clean (no `whrb-web` source changes beyond `package.json` puppeteer devDep) |

Replay scratch branches were ephemeral and have been deleted; the
durable record is the PR body + this entry.

### Rollback

Revert the PR #23 merge commit once it lands — atomic removal of the
gate surface, returning `main` to the post-UI-foundation state
(`9d99a08`). Each of the 5 intra-branch commits is independently
revertable; commit 5 (enforce flip) is the single lowest-risk revert
if the gate proves too aggressive — drops back to diagnostic mode
without unwinding the skills/helpers.

### Next

Stage T2 (tag emitters + cannabis block + backfill + daypart view) —
per the `feedback_no_auto_stage_advance.md` rule — does **not** start
until an explicit "start T2" command. T2 is pipeline-only (no files
under the UI-affecting globs in plan §5), so the pre-push gate is a
no-op for T2 pushes even if this PR merges first. T3 (rep UI: chips,
filters, lock, clear, notifications, undo) is the first stage that
exercises the gate in anger; infra merge before T3 is strongly
preferred.

---


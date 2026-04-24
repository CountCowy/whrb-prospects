# UI verification gates

**Status**: active since `infra/ui-verification-gates` merged to `main` on 2026-04-24.

This document explains the three-mechanism UI verification infrastructure layered on top of `ui/foundation` (PR #22). It answers:

- What gets gated, and by what.
- How to run the gates manually.
- How to bypass them in an emergency.
- Where the audit trail lives.

The design plan is `/Users/countcowy/.claude/plans/ui-verification-infrastructure.md` — this doc is the operator's view.

---

## 1. What the gate catches

Five bugs landed on `ui/foundation` before any reviewer caught them:

| Bug | Catch mechanism |
|---|---|
| Hero tile grid-span on wrong element (collapsed 1×1) | `/verify-ui` screenshot |
| Nav tab icons missing entirely | `/verify-ui` screenshot |
| Hero gradient double-alpha → white on white | `/verify-ui` screenshot |
| ColumnVisibilityMenu Checkbox-in-label (click unresponsive) | `/review-ui` agent finding |
| NotificationBell icon cascade (16 vs 18 px race) | `/review-ui` agent finding |

Every one was invisible to `pnpm build`, `pnpm lint`, `pnpm typecheck`, and the Playwright a11y spec. The gate exists because those tools don't look at pixels, and shadcn cva + Radix semantics are below most linters' resolution.

---

## 2. The three mechanisms

### Pre-push hook — `.claude/hooks/ui-pre-push-gate.sh`

Registered in `.claude/settings.json` as a `PreToolUse` hook against `Bash` and the `mcp__github__(create_pull_request|update_pull_request_branch|push_files|merge_pull_request)` matcher set. Intercepts only push/merge operations; everything else is a silent allow.

Decision matrix (enforce mode):

| UI diff | `.ui-verified.json` | `.review-clean.json` | Result |
|---|---|---|---|
| empty | — | — | allow |
| non-empty | missing | — | deny → `/verify-ui` |
| non-empty | stale (>15 min) | — | deny → `/verify-ui` |
| non-empty | coverage gap | — | deny → `/verify-ui` |
| non-empty | screenshot missing / corrupt / sha mismatch | — | deny → `/verify-ui` |
| non-empty | fewer observations than routes | — | deny → `/verify-ui` |
| non-empty | fresh + intact | missing / stale / gap | deny → `/review-ui` |
| non-empty | fresh + intact | fresh + `unresolved_blocking > 0` | deny |
| non-empty | fresh + intact | fresh + intact | allow |

Modes live in the env var `UI_VERIFY_MODE`:

- `enforce` (default): deny paths fire.
- `diagnostic`: deny paths log their reason but emit `{}` allow. Useful if the gate regresses and we want to observe without blocking.

### `/verify-ui` skill

- `.claude/skills/verify-ui/SKILL.md` — orchestrates.
- `.claude/hooks/helpers/run-verify.mjs` — puppeteer + in-process Supabase auth → LoginForm hash-token handoff → route×theme×probe iteration → PNG + sha256 bookkeeping.
- `.claude/hooks/helpers/all-authed-routes.json` — single source of truth for the route list.
- `.claude/hooks/helpers/probes.json` — interactive probes (click column-toggle, press Meta+K, etc.) — covers the triggered-state bug class that idle screenshots miss.

Steps the skill performs:

1. Ensure `pnpm dev` is on `:3000`.
2. Run the runner — 44 captures (15 routes × 2 themes + 8 probes) in ~3 min cold / <90 s warm.
3. Claude uses the `Read` tool on each PNG (the image enters context this way — markdown refs do NOT render in tool output).
4. Claude appends `observations[]` to `.ui-verified.json` via `Edit`, ≥ 3 notes per capture. The hook rejects any manifest whose observations don't cover every capture.

Forgery resistance: the hook recomputes `sha256(file)` on every PNG and compares against the manifest's `routes[].sha256`. Hand-editing the manifest to skip the inspection fails this check. Every PNG is additionally validated for magic bytes + size ≥ 50 KB + mtime within ±60 s of `timestamp`.

### `/review-ui` skill

- `.claude/skills/review-ui/SKILL.md` — orchestrates.
- `.claude/skills/review-ui/audit-prompt.md` — fixed prompt with ten bug categories + severity rubric.
- `.claude/hooks/helpers/parse-findings.sh` — extracts + validates the FINDINGS-JSON block from the agent response.

`disable-model-invocation: true` — the skill never auto-fires from description match. Path is always: hook denies → Claude reads the deny reason → Claude types `/review-ui` on the next turn → skill spawns a general-purpose agent → findings parsed → `.review-clean.json` written only if `critical.length + high.length == 0`.

---

## 3. Running manually

```bash
# A UI change sits in the worktree — your next push will deny.
/verify-ui                    # runs the runner + populates observations
/review-ui                    # spawns the review agent
git push origin my-branch     # now passes the gate
```

The typical flow inside a session:

1. Finish the UI change.
2. Ask Claude to push. The hook denies with a reason.
3. Claude (or you) types `/verify-ui`. The runner fires; Claude reads screenshots; observations go in the manifest.
4. Claude (or you) types `/review-ui`. The agent spawns; findings print; `.review-clean.json` is written if no blocking items.
5. Push again. Passes.

**Freshness:** both manifests expire after 15 min. If more than ~15 min has passed between `/verify-ui` and `git push`, re-run `/verify-ui` (very fast when the dev server is still warm).

---

## 4. Emergency bypass

Two paths, both leave audit trails:

1. **`UI_VERIFY_SKIP=1 git push …`** — allow + append to `~/.claude/audit/<repo-name>/verify-skipped.log` with timestamp + sha + file list. Used when an external system is broken (Supabase rotated, Chrome not installed, dev server can't start).

2. **`UI_VERIFY_MODE=diagnostic` in `.claude/settings.json`** — the gate observes but does not deny. Use for debugging or when rolling out a hook change; flip back to `enforce` as soon as possible. The commit that flipped to `diagnostic` is itself the audit trail — `git log .claude/settings.json`.

There is **no** `--no-verify` / `--force` style flag. The hook runs in-process of the Claude harness; Claude cannot argparse around it.

---

## 5. Audit trail

- `~/.claude/audit/Listing/verify-skipped.log` — one line per `UI_VERIFY_SKIP=1` bypass. Outside the worktree so `rm -rf` and worktree cleanups don't erase it.
- Git log — every flip of `UI_VERIFY_MODE` is a committed diff.
- `.ui-verified.json` and `.review-clean.json` — gitignored, regenerated per run. Not audit artifacts; they are ephemeral gate inputs.

---

## 6. Extending the gate

### New authed route

Add it to `.claude/hooks/helpers/all-authed-routes.json`. If the route has a triggered state worth screenshotting (menu open, modal open, hover), add a probe to `.claude/hooks/helpers/probes.json`.

### New UI file glob

Edit `.claude/hooks/helpers/changed-ui-files.sh`. Update `INCLUDE` / `EXCLUDE`. Re-run `bats .claude/hooks/test/pre-push-gate.bats` after any change.

### New audit category

Edit `.claude/skills/review-ui/audit-prompt.md` — add the category with definition + example. Matching `category` strings in FINDINGS-JSON do not need code changes (the parser is generic).

### Rotating Supabase creds

Update `whrb-web/.env.local` with new `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VERIFY_DEV_EMAIL`. The runner reads `.env.local` fresh every invocation.

---

## 7. Testing

```bash
bats .claude/hooks/test/pre-push-gate.bats     # 11 scenarios — hook logic
bats .claude/hooks/test/parse-findings.bats    # 6 scenarios — JSON parser
node .claude/hooks/helpers/run-verify.mjs --dry-run   # runner matrix
```

All three must be green before the gate is trusted to enforce.

---

## 8. Historical-replay merge gate

The infra PR (`infra/ui-verification-gates`) merge gate required all five historical bugs to be individually re-introduced on scratch branches cut off the infra tip, with the active gate confirmed to block each one. That replay evidence lives in the PR #23 description and is the permanent record of "this actually works."

Post-merge the replay branches were deleted; they are not retained.

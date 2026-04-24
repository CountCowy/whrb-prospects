#!/usr/bin/env bash
# Print UI-affecting files changed on the current branch, one per line.
# Used by .claude/hooks/ui-pre-push-gate.sh and the /verify-ui and /review-ui
# skills to decide whether the UI gates apply and which files to cover.
#
# Include globs (whrb-web/-scoped):
#   app/**/*.tsx, app/**/*.css, components/**/*.tsx,
#   tailwind.config.*, postcss.config.*, components.json, lib/utils.ts
# Exclude globs:
#   app/api/**, *.test.(ts|tsx), e2e/**

set -euo pipefail

BASE="${UI_VERIFY_BASE:-origin/main}"

INCLUDE='^whrb-web/(app/.*\.(tsx|css)|components/.*\.tsx|tailwind\.config\.|postcss\.config\.|components\.json|lib/utils\.ts)$'
EXCLUDE='^whrb-web/(app/api/|components/.*\.test\.(ts|tsx)$|e2e/)'

# Branch-tip diff against origin/main (or the caller-chosen BASE).
committed=""
if git rev-parse --verify "${BASE}" >/dev/null 2>&1; then
  committed="$(git diff --name-only --diff-filter=ACMR "${BASE}...HEAD" \
    | grep -E "$INCLUDE" \
    | grep -Ev "$EXCLUDE" \
    || true)"
fi

# Staged changes.
staged="$(git diff --name-only --cached --diff-filter=ACMR \
  | grep -E "$INCLUDE" \
  | grep -Ev "$EXCLUDE" \
  || true)"

# Unstaged working-tree changes.
unstaged="$(git diff --name-only --diff-filter=ACMR \
  | grep -E "$INCLUDE" \
  | grep -Ev "$EXCLUDE" \
  || true)"

# Untracked files the caller has added but not yet staged.
untracked="$(git ls-files --others --exclude-standard \
  | grep -E "$INCLUDE" \
  | grep -Ev "$EXCLUDE" \
  || true)"

# The pipeline below can legitimately produce zero lines (empty UI diff).
# `grep` exits 1 on no-match and would tank the whole script under `set -e`,
# so swallow that specific case with `|| true`.
printf '%s\n%s\n%s\n%s\n' "$committed" "$staged" "$unstaged" "$untracked" \
  | grep -v '^$' \
  | sort -u \
  || true

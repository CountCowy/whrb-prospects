#!/usr/bin/env bash
# Stage T4 CI gate — PRs labeled `rep-ui-change` must include a
# changelog INSERT (either a new migration or a seed-style SQL block
# anywhere in the diff). Fails CI if the label is present but no diff
# touches `changelog_entries`.
#
# Designed to be invoked from a GitHub Actions step:
#   - run: bash whrb-prospects/scripts/ci_require_changelog.sh
#     env:
#       PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}
#       BASE_SHA: ${{ github.event.pull_request.base.sha }}
#       HEAD_SHA: ${{ github.event.pull_request.head.sha }}
#
# Locally:
#   PR_LABELS='["rep-ui-change"]' BASE_SHA=main bash scripts/ci_require_changelog.sh

set -euo pipefail

LABELS_JSON="${PR_LABELS:-[]}"
BASE_SHA="${BASE_SHA:-main}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

# Quick string-search for the label (avoids a jq dependency).
case "$LABELS_JSON" in
  *"\"rep-ui-change\""*)
    echo "PR is labeled rep-ui-change — checking for changelog_entries INSERT…"
    ;;
  *)
    echo "PR is not labeled rep-ui-change — skipping changelog gate."
    exit 0
    ;;
esac

DIFF_RANGE="${BASE_SHA}...${HEAD_SHA}"

# Look for an `insert into changelog_entries` (case-insensitive) anywhere
# in the additions of this PR. Migrations + seeds + plant scripts all
# count.
if git diff --diff-filter=AM "$DIFF_RANGE" -- '*.sql' '*.py' '*.ts' '*.tsx' \
  | grep -iE '^\+.*insert\s+into\s+(public\.)?changelog_entries' >/dev/null
then
  echo "Found changelog_entries INSERT in diff — gate satisfied."
  exit 0
fi

echo "ERROR: PR labeled 'rep-ui-change' must include an INSERT into" >&2
echo "       public.changelog_entries (migration, seed, or plant script)." >&2
echo "       See scripts/ci_require_changelog.sh + plan §6.4." >&2
exit 1

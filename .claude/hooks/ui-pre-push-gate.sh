#!/usr/bin/env bash
# .claude/hooks/ui-pre-push-gate.sh
#
# PreToolUse hook: validates UI verification state before a push / merge.
# Registered in .claude/settings.json against Bash + the relevant
# mcp__github__* tools. Intercepts hook input on stdin (JSON), decides
# whether to allow or deny the operation.
#
# Modes:
#   UI_VERIFY_MODE=enforce   (default, set via settings.json env) — denies
#                            any UI-touching push that lacks fresh,
#                            intact .ui-verified.json + .review-clean.json.
#   UI_VERIFY_MODE=diagnostic — prints the same diagnostic but always
#                               allows; used during commits 2–4 before
#                               commit 5 flips the gate on.
#
# Bypass:
#   UI_VERIFY_SKIP=1         — allow the push but log to
#                              ~/.claude/audit/<repo>/verify-skipped.log.
#
# Integrity checks (enforce mode):
#   - Manifest file exists.
#   - Manifest `timestamp` within STALE_AFTER_SECS (900s = 15 min).
#   - Manifest `files_covered` is a superset of the current UI diff.
#   - Every routes[].screenshot exists on disk with PNG magic bytes,
#     size ≥ 50 KB, mtime within ±60s of timestamp, and sha256 matching
#     the manifest value.
#   - `observations` array has one entry per `routes[]` item, each with
#     ≥ 3 non-empty notes (inspection-enforcement).

set -euo pipefail

# ---------- stdin + mode resolution ----------

INPUT="$(cat)"
HOOK_EVENT="$(echo "$INPUT" | jq -r '.hook_event_name // empty')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty')"
TOOL_CMD="$(echo "$INPUT" | jq -r '.tool_input.command // empty')"

MODE="${UI_VERIFY_MODE:-enforce}"
STALE_AFTER_SECS="${UI_VERIFY_STALE_SECS:-900}"

is_push_command() {
  # Match: `git push`, `git push origin …`, `git push -u …`, also
  # `UI_VERIFY_SKIP=1 git push …` and `env FOO=bar git push …` so the
  # documented bypass shorthand doesn't silently sidestep this gate.
  # Exclude: `git push --help`, `git push-files` (not a real cmd, but safe).
  if [[ "$TOOL_NAME" == "Bash" ]]; then
    local cmd="$TOOL_CMD"
    # Trim leading whitespace.
    cmd="${cmd#"${cmd%%[![:space:]]*}"}"
    # Strip optional `env` builtin.
    if [[ "$cmd" =~ ^env[[:space:]]+ ]]; then
      cmd="${cmd#env}"
      cmd="${cmd#"${cmd%%[![:space:]]*}"}"
    fi
    # Strip leading shell env-var assignments (`VAR=val`, `VAR='q'`, `VAR="q"`).
    while [[ "$cmd" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
      local key="${cmd%%=*}"
      local rest="${cmd#${key}=}"
      case "$rest" in
        \'*)
          local val="${rest#\'}"
          val="${val%%\'*}"
          cmd="${rest#\'${val}\'}"
          ;;
        \"*)
          local val="${rest#\"}"
          val="${val%%\"*}"
          cmd="${rest#\"${val}\"}"
          ;;
        *)
          local val="${rest%%[[:space:]]*}"
          cmd="${rest#${val}}"
          ;;
      esac
      cmd="${cmd#"${cmd%%[![:space:]]*}"}"
    done
    [[ "$cmd" =~ ^git[[:space:]]+push([[:space:]]|$) ]] && return 0
    return 1
  fi
  # MCP tool names matching the PR/merge surface.
  case "$TOOL_NAME" in
    mcp__github__create_pull_request|mcp__github__update_pull_request_branch|mcp__github__push_files|mcp__github__merge_pull_request)
      return 0 ;;
  esac
  return 1
}

if ! is_push_command; then
  echo '{}' && exit 0
fi

cd "$(git rev-parse --show-toplevel)"
UI_FILES="$(.claude/hooks/helpers/changed-ui-files.sh)"

if [[ -z "$UI_FILES" ]]; then
  echo '{}' && exit 0
fi

HEAD_SHA="$(git rev-parse HEAD)"
NOW_EPOCH="$(date +%s)"

# ---------- helpers ----------

banner() {
  >&2 echo "[ui-pre-push-gate] $*"
}

deny() {
  local reason="$1"
  if [[ "$MODE" == "diagnostic" ]]; then
    banner "DIAGNOSTIC: would deny (mode=$MODE). Reason:"
    while IFS= read -r ln; do banner "  $ln"; done <<< "$reason"
    echo '{}' && exit 0
  fi
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

audit_skip() {
  local repo_name
  repo_name="$(basename "$(git rev-parse --show-toplevel)")"
  local audit_dir="${HOME}/.claude/audit/${repo_name}"
  mkdir -p "$audit_dir"
  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) sha=$HEAD_SHA files=$(wc -l <<<"$UI_FILES" | tr -d ' ')"
    echo "$UI_FILES" | sed 's/^/  /'
  } >> "${audit_dir}/verify-skipped.log"
}

parse_ts_to_epoch() {
  local ts="$1"
  date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null \
    || date -d "$ts" +%s 2>/dev/null \
    || echo 0
}

check_manifest() {
  local path="$1"        # .ui-verified.json or .review-clean.json
  local friendly="$2"    # /verify-ui or /review-ui

  [[ -f "$path" ]] || deny "$friendly has not been run yet. Changed UI files:
$UI_FILES

Run $friendly before pushing."

  local ts covered
  ts="$(jq -r '.timestamp' "$path" 2>/dev/null || echo '')"
  covered="$(jq -r '.files_covered[]? // empty' "$path" 2>/dev/null | sort -u)"

  if [[ -z "$ts" ]]; then
    deny "$friendly manifest $path is missing a timestamp. Re-run $friendly."
  fi

  local ts_epoch
  ts_epoch="$(parse_ts_to_epoch "$ts")"
  if (( NOW_EPOCH - ts_epoch > STALE_AFTER_SECS )); then
    deny "$friendly manifest is stale (>${STALE_AFTER_SECS}s old). Re-run $friendly."
  fi

  local missing=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if ! echo "$covered" | grep -qxF "$f"; then
      missing="$missing
  $f"
    fi
  done <<< "$UI_FILES"
  if [[ -n "$missing" ]]; then
    deny "$friendly manifest does not cover these changed files:${missing}

Re-run $friendly so files_covered ⊇ the current UI diff."
  fi
}

# .ui-verified.json specific: independently validate every referenced
# screenshot on disk. A hand-written manifest fails this check.
check_screenshot_integrity() {
  local path=".ui-verified.json"
  local n
  n="$(jq '.routes | length' "$path" 2>/dev/null || echo 0)"
  (( n > 0 )) || deny "/verify-ui manifest lists zero screenshots. Re-run /verify-ui."

  local i
  for (( i=0; i<n; i++ )); do
    local s_path s_sha
    s_path="$(jq -r ".routes[$i].screenshot" "$path")"
    s_sha="$(jq -r ".routes[$i].sha256" "$path")"

    [[ -f "$s_path" ]] || deny "Screenshot missing on disk: $s_path. Re-run /verify-ui."

    local magic
    magic="$(head -c 4 "$s_path" | xxd -p | tr -d '\n')"
    [[ "$magic" == "89504e47" ]] || deny "Screenshot is not a PNG: $s_path. Re-run /verify-ui."

    local size
    size="$(wc -c <"$s_path" | tr -d ' ')"
    (( size >= 50000 )) || deny "Screenshot under 50 KB (likely empty/broken): $s_path. Re-run /verify-ui."

    local actual
    actual="$(shasum -a 256 "$s_path" | cut -d' ' -f1)"
    [[ "$actual" == "$s_sha" ]] || deny "Screenshot sha256 does not match manifest: $s_path.

Do not hand-edit the manifest — re-run /verify-ui so the runner computes fresh hashes."
  done

  # Observations coverage + minimum non-triviality.
  local obs_n
  obs_n="$(jq '.observations | length' "$path" 2>/dev/null || echo 0)"
  (( obs_n == n )) || deny "/verify-ui manifest has $obs_n observations for $n screenshots.

Re-run /verify-ui and fill in observations for every capture (step 5 of the skill)."

  local empties
  empties="$(jq '[.observations[] | select((.notes // [] | length) < 3)] | length' "$path" 2>/dev/null || echo 0)"
  (( empties == 0 )) || deny "$empties screenshot(s) have fewer than 3 observations in .ui-verified.json.

The observations step is not optional — look at each capture and record what you see before pushing."
}

# ---------- bypass ----------

if [[ "${UI_VERIFY_SKIP:-}" == "1" ]]; then
  audit_skip
  banner "UI_VERIFY_SKIP=1 — allowed, logged to ~/.claude/audit/$(basename "$(git rev-parse --show-toplevel)")/verify-skipped.log"
  echo '{}' && exit 0
fi

# ---------- diagnostic banner ----------

banner "UI diff detected ($(wc -l <<<"$UI_FILES" | tr -d ' ') file(s)); mode=$MODE"

# ---------- checks ----------

check_manifest ".ui-verified.json" "/verify-ui"
check_screenshot_integrity
# /review-ui required on ANY UI diff (≥1 UI file) — r2 lowered this
# threshold so single-file Radix/cva mistakes are covered.
check_manifest ".review-clean.json" "/review-ui"

# Additionally verify the review manifest has unresolved_blocking == 0.
if [[ -f .review-clean.json ]]; then
  blocking="$(jq -r '.unresolved_blocking // 0' .review-clean.json)"
  if (( blocking != 0 )); then
    deny "/review-ui manifest reports $blocking unresolved blocking findings. Address them, then re-run /review-ui."
  fi
fi

banner "all gates passed."
echo '{}' && exit 0

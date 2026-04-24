#!/usr/bin/env bats
# .claude/hooks/test/pre-push-gate.bats
#
# Black-box tests for .claude/hooks/ui-pre-push-gate.sh. Each scenario:
#   - bootstraps a temporary git worktree (so we don't mutate the real repo
#     state), copies the hook + helpers into it, seeds whatever manifest /
#     UI diff the scenario needs, feeds the hook JSON on stdin, and asserts
#     on the hook's decision JSON.
#   - runs the hook in enforce mode (UI_VERIFY_MODE=enforce) so deny paths
#     actually emit permissionDecision: "deny" (diagnostic mode swallows
#     those and always allows).

setup_file() {
  SRC_ROOT="$(git rev-parse --show-toplevel)"
  export SRC_ROOT
}

setup() {
  TEST_ROOT="$(mktemp -d)"
  export TEST_ROOT

  # Minimal repo layout so the hook's `git rev-parse --show-toplevel`
  # + `git diff` calls work.
  cd "$TEST_ROOT"
  git init -q -b main
  git config user.email bats@example.com
  git config user.name bats
  git config commit.gpgsign false
  echo README > README.md && git add README.md && git commit -q -m init

  # Point origin/main at HEAD so changed-ui-files.sh has a base.
  git remote add origin "$TEST_ROOT/.git"
  git fetch -q origin || true
  git update-ref refs/remotes/origin/main HEAD

  # Cut a feature branch so we can add files on top of origin/main.
  git checkout -q -b feature

  # Copy the hook + helpers.
  mkdir -p .claude/hooks/helpers .claude/screenshots
  cp "$SRC_ROOT/.claude/hooks/ui-pre-push-gate.sh" .claude/hooks/
  cp "$SRC_ROOT/.claude/hooks/helpers/changed-ui-files.sh" .claude/hooks/helpers/
  chmod +x .claude/hooks/ui-pre-push-gate.sh .claude/hooks/helpers/changed-ui-files.sh

  export UI_VERIFY_MODE=enforce
  export UI_VERIFY_STALE_SECS=900
  # Route the audit-skip log into TEST_ROOT so tests don't touch
  # the real ~/.claude/audit/ tree.
  export HOME="$TEST_ROOT"
  unset UI_VERIFY_SKIP
}

teardown() {
  cd /
  rm -rf "$TEST_ROOT"
}

# ---------- helpers ----------

seed_ui_diff() {
  mkdir -p whrb-web/components
  echo "export const X = 1;" > whrb-web/components/Demo.tsx
  git add whrb-web/components/Demo.tsx && git commit -q -m "ui: demo"
}

make_png() {
  # Generate a ≥50KB valid PNG at $1. Uses random pixel data so the IDAT
  # chunk doesn't compress away; then appends a benign tEXt chunk as
  # padding so the total is comfortably above the hook's 50KB floor.
  local path="$1"
  mkdir -p "$(dirname "$path")"
  python3 - "$path" <<'PY'
import os, struct, sys, zlib
path = sys.argv[1]
W = H = 200
# Random-ish bytes so zlib can't collapse the image to tiny.
raw = b''.join(b'\x00' + os.urandom(W) for _ in range(H))
compressed = zlib.compress(raw, 1)

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

sig = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', W, H, 8, 0, 0, 0, 0)  # grayscale, no filter

# Pad up to ≥ 60KB via a tEXt chunk so the hook's 50KB floor is cleared.
filler_len = max(0, 61_000 - (len(sig) + 12 + len(ihdr) + 12 + len(compressed) + 12))
text_payload = b'pad\x00' + (b'X' * filler_len)

png = (
    sig
    + chunk(b'IHDR', ihdr)
    + chunk(b'IDAT', compressed)
    + chunk(b'tEXt', text_payload)
    + chunk(b'IEND', b'')
)
open(path, 'wb').write(png)
assert os.path.getsize(path) >= 50_000, os.path.getsize(path)
PY
}

seed_valid_manifest() {
  local ui_file="${1:-whrb-web/components/Demo.tsx}"
  local shot=".claude/screenshots/abcdefg/home-light.png"
  make_png "$shot"
  local sha
  sha="$(shasum -a 256 "$shot" | cut -d' ' -f1)"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat > .ui-verified.json <<EOF
{
  "timestamp": "$ts",
  "commit_sha": "$(git rev-parse HEAD)",
  "branch": "feature",
  "routes": [
    {"path":"/", "theme":"light", "probe":null, "screenshot":"$shot", "sha256":"$sha"}
  ],
  "observations": [
    {"screenshot":"$shot","notes":["note 1","note 2","note 3"],"defects_found":[]}
  ],
  "files_covered": ["$ui_file"],
  "captured_by": "verify-ui-skill@v2",
  "runner_version": "run-verify.mjs@v1"
}
EOF

  cat > .review-clean.json <<EOF
{
  "timestamp": "$ts",
  "commit_sha": "$(git rev-parse HEAD)",
  "branch": "feature",
  "findings": {"critical":[], "high":[], "medium":[], "low":[], "nit":[]},
  "unresolved_blocking": 0,
  "files_covered": ["$ui_file"],
  "agent_run_id": "bats-fixture"
}
EOF
}

hook_input() {
  # Emit the Claude-Code hook stdin JSON for a Bash git push call.
  cat <<EOF
{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push origin feature"}}
EOF
}

run_hook() {
  hook_input | bash .claude/hooks/ui-pre-push-gate.sh 2>/tmp/gate.err
  rc=$?
  export GATE_ERR="$(cat /tmp/gate.err || true)"
  return $rc
}

decision() {
  echo "$1" | jq -r '.hookSpecificOutput.permissionDecision // empty'
}

reason() {
  echo "$1" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty'
}

# ---------- scenarios ----------

run_hook_test() {
  # Run the hook with stdin JSON; stderr discarded (banner text lives on
  # stderr and would otherwise pollute $output).
  local stdin="$1"
  cd "$TEST_ROOT"
  bash -c "echo '$stdin' | bash .claude/hooks/ui-pre-push-gate.sh 2>/dev/null"
}

PUSH_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push origin feature"}}'
LS_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls -la"}}'

@test "A: non-push Bash command → allow (no hook output beyond '{}')" {
  run run_hook_test "$LS_INPUT"
  [ "$status" -eq 0 ]
  [ "$output" = '{}' ]
}

@test "B: no UI diff → allow" {
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$output" = '{}' ]
}

@test "C: UI diff, no .ui-verified.json → deny with /verify-ui" {
  seed_ui_diff
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"/verify-ui"* ]]
}

@test "D: UI diff, manifest covers wrong file → deny (coverage gap)" {
  seed_ui_diff
  seed_valid_manifest "whrb-web/components/Unrelated.tsx"
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"does not cover"* ]]
}

@test "E: UI diff, referenced PNG missing on disk → deny" {
  seed_ui_diff
  seed_valid_manifest
  rm .claude/screenshots/abcdefg/home-light.png
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"missing on disk"* ]]
}

@test "F: UI diff, sha256 in manifest does not match disk → deny" {
  seed_ui_diff
  seed_valid_manifest
  jq '.routes[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000"' \
    .ui-verified.json > .ui-verified.json.tmp && mv .ui-verified.json.tmp .ui-verified.json
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"sha256 does not match"* ]]
}

@test "G: UI diff, observations empty → deny" {
  seed_ui_diff
  seed_valid_manifest
  jq '.observations = []' .ui-verified.json > .ui-verified.json.tmp && mv .ui-verified.json.tmp .ui-verified.json
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"observations"* ]]
}

@test "H: UI diff, observations with 2 notes only → deny (minimum 3)" {
  seed_ui_diff
  seed_valid_manifest
  jq '.observations[0].notes = ["only","two"]' .ui-verified.json > .ui-verified.json.tmp && mv .ui-verified.json.tmp .ui-verified.json
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"fewer than 3 observations"* ]]
}

@test "I: UI diff, fresh manifests, no .review-clean.json → deny with /review-ui" {
  seed_ui_diff
  seed_valid_manifest
  rm -f .review-clean.json
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$(decision "$output")" = "deny" ]
  [[ "$(reason "$output")" == *"/review-ui"* ]]
}

@test "J: UI diff, everything fresh + intact → allow" {
  seed_ui_diff
  seed_valid_manifest
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$output" = '{}' ]
}

@test "K: UI diff, UI_VERIFY_SKIP=1 → allow + audit log written" {
  seed_ui_diff
  export UI_VERIFY_SKIP=1
  run run_hook_test "$PUSH_INPUT"
  [ "$status" -eq 0 ]
  [ "$output" = '{}' ]
  log_path="$TEST_ROOT/.claude/audit/$(basename "$TEST_ROOT")/verify-skipped.log"
  [ -f "$log_path" ]
  grep -q "sha=" "$log_path"
}

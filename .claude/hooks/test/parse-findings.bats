#!/usr/bin/env bats
# Unit tests for .claude/hooks/helpers/parse-findings.sh.
# Covers the three acceptance paths of commit 4: valid clean response,
# valid response with blocking findings, malformed response.

setup() {
  SCRIPT="$(git rev-parse --show-toplevel)/.claude/hooks/helpers/parse-findings.sh"
}

@test "clean response → JSON extracted, zero blocking" {
  INPUT='Some pre-amble.
1. [medium] [palette-contrast-drift] whrb-web/app/globals.css:12 — close-but-passing 4.47:1
    Fix: bump lightness +2.
=== FINDINGS-JSON-START ===
{
  "critical": [],
  "high": [],
  "medium": [{"file":"whrb-web/app/globals.css","line":12,"category":"palette-contrast-drift","summary":"close"}],
  "low": [],
  "nit": []
}
=== FINDINGS-JSON-END ===
Trailing text.'
  out="$(echo "$INPUT" | bash "$SCRIPT")"
  echo "out: $out" >&2
  [ "$(echo "$out" | jq '.critical | length')" = "0" ]
  [ "$(echo "$out" | jq '.high | length')" = "0" ]
  [ "$(echo "$out" | jq '.medium | length')" = "1" ]
}

@test "critical finding present → JSON extracted with blocking count > 0" {
  INPUT='=== FINDINGS-JSON-START ===
{"critical":[{"file":"x.tsx","line":1,"category":"grid-span-misplacement","summary":"hero collapsed"}],
 "high":[],"medium":[],"low":[],"nit":[]}
=== FINDINGS-JSON-END ==='
  out="$(echo "$INPUT" | bash "$SCRIPT")"
  [ "$(echo "$out" | jq '.critical | length')" = "1" ]
  [ "$(echo "$out" | jq '[.critical, .high] | add | length')" = "1" ]
}

@test "missing START marker → non-zero exit" {
  INPUT='Just findings text, no machine block.'
  run bash -c "echo '$INPUT' | bash \"$SCRIPT\""
  [ "$status" -ne 0 ]
}

@test "missing END marker → non-zero exit" {
  INPUT='=== FINDINGS-JSON-START ===
{"critical":[],"high":[],"medium":[],"low":[],"nit":[]}'
  run bash -c "echo '$INPUT' | bash \"$SCRIPT\""
  [ "$status" -ne 0 ]
}

@test "malformed JSON between markers → non-zero exit" {
  INPUT='=== FINDINGS-JSON-START ===
{ not valid JSON at all }
=== FINDINGS-JSON-END ==='
  run bash -c "echo '$INPUT' | bash \"$SCRIPT\""
  [ "$status" -ne 0 ]
}

@test "JSON missing a severity bucket → non-zero exit" {
  INPUT='=== FINDINGS-JSON-START ===
{"critical":[],"high":[],"medium":[]}
=== FINDINGS-JSON-END ==='
  run bash -c "echo '$INPUT' | bash \"$SCRIPT\""
  [ "$status" -ne 0 ]
}

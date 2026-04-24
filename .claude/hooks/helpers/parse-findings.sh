#!/usr/bin/env bash
# .claude/hooks/helpers/parse-findings.sh
#
# Extracts the FINDINGS-JSON block from the review agent's response.
# Reads the response on stdin; prints only the JSON between the markers
# on stdout. Exits non-zero when the markers are missing or the block
# is not valid JSON — the /review-ui skill relies on that to decide
# whether to write .review-clean.json.
#
# Marker contract (matches audit-prompt.md):
#   === FINDINGS-JSON-START ===
#   { ... }
#   === FINDINGS-JSON-END ===

set -euo pipefail

RESPONSE="$(cat)"

if ! echo "$RESPONSE" | grep -q '=== FINDINGS-JSON-START ==='; then
  echo "parse-findings: missing FINDINGS-JSON-START marker" >&2
  exit 2
fi
if ! echo "$RESPONSE" | grep -q '=== FINDINGS-JSON-END ==='; then
  echo "parse-findings: missing FINDINGS-JSON-END marker" >&2
  exit 3
fi

json="$(echo "$RESPONSE" \
  | awk '/=== FINDINGS-JSON-START ===/{flag=1;next} /=== FINDINGS-JSON-END ===/{flag=0} flag')"

if [[ -z "$json" ]]; then
  echo "parse-findings: empty block between markers" >&2
  exit 4
fi

# Validate JSON shape: must parse and expose the five severity arrays.
if ! echo "$json" | jq -e '
    (.critical // null) != null and
    (.high // null)     != null and
    (.medium // null)   != null and
    (.low // null)      != null and
    (.nit // null)      != null
  ' >/dev/null 2>&1; then
  echo "parse-findings: JSON missing one of critical|high|medium|low|nit" >&2
  exit 5
fi

echo "$json"

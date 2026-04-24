---
name: review-ui
description: Spawn a thorough code-review subagent on the current UI diff and write .review-clean.json if no critical/high findings remain. The pre-push hook denies any UI-touching push without this manifest; the denial reason tells you to run /review-ui manually. User-invoked only — disable-model-invocation: true keeps the agent spawn explicit.
argument-hint: ""
allowed-tools: Bash, Read, Write, Agent
disable-model-invocation: true
---

# /review-ui

Your task is to spawn a review subagent, parse its output, and write
`.review-clean.json` **only if** zero critical/high findings remain open.

**Invocation.** This skill is user-invoked (typed as `/review-ui`) OR
invoked by you on the turn *after* the pre-push hook denies with
"run /review-ui first" in its permission-decision reason. The hook
cannot call the skill directly; the flow is always:

```
hook denies → you read the reason → you type /review-ui → skill runs
→ .review-clean.json written → you retry the push
```

## Steps

1. **Collect the UI diff.**

   ```
   .claude/hooks/helpers/changed-ui-files.sh
   ```

   Capture the list of changed UI files. If the list is empty, there is
   nothing to review — tell the user and exit without writing a manifest.

2. **Read the fixed audit prompt.**

   ```
   cat .claude/skills/review-ui/audit-prompt.md
   ```

   This is the canonical prompt: ten bug categories + explicit severity
   examples + required output format.

3. **Spawn the review agent.**

   Use the `Agent` tool with:
   - `subagent_type`: `general-purpose`
   - `description`: "UI review for current diff"
   - `prompt`: the contents of `audit-prompt.md`, followed by a block
     with the changed-file list and the branch + base SHAs so the agent
     can `git diff` targeted files.

   The agent is restricted to read-only tools by design of the
   general-purpose agent's prompt (no Edit / Write allowed in its
   deliverable) — it reports findings and returns.

4. **Parse FINDINGS-JSON.**

   The agent's response MUST end with:

   ```
   === FINDINGS-JSON-START ===
   { "critical": [...], "high": [...], "medium": [...], "low": [...], "nit": [] }
   === FINDINGS-JSON-END ===
   ```

   Pipe the full agent response through the helper:

   ```
   echo "$AGENT_RESPONSE" | bash .claude/hooks/helpers/parse-findings.sh
   ```

   The helper exits non-zero if markers are missing, the block between
   them is empty, or the JSON is malformed / missing a severity bucket.
   On non-zero exit: print the raw agent output, tell the user the
   review is not auditable, and **do not write the manifest**. On zero
   exit: the extracted JSON is printed to stdout — capture it for step 5.

5. **Decide.**

   - If `critical.length + high.length > 0`:
     - Print every finding with file + line + category + severity + summary.
     - Print: "Fix the N blocking findings, then re-run `/review-ui`."
     - **Do NOT write `.review-clean.json`.**
     - Exit.

   - Otherwise:
     - Write `.review-clean.json` per the schema below.
     - Print: "N medium / M low / K nit findings logged; 0 blocking. Manifest at .review-clean.json."

## `.review-clean.json` schema

```json
{
  "timestamp": "2026-04-24T22:50:00Z",
  "commit_sha": "abcd1234…",
  "branch": "infra/ui-verification-gates",
  "findings": {
    "critical": [],
    "high": [],
    "medium": [ { "file": "...", "line": 42, "category": "...", "summary": "..." } ],
    "low": [],
    "nit": []
  },
  "unresolved_blocking": 0,
  "files_covered": ["whrb-web/components/Nav.tsx", "…"],
  "agent_run_id": "<free-form id, e.g. the Agent invocation description>"
}
```

The pre-push hook checks `unresolved_blocking == 0`, the 15-minute
freshness, and that `files_covered ⊇ current UI diff`. Populate
`files_covered` from step 1's output.

## Notes

- The description-based auto-fire trigger is **disabled**
  (`disable-model-invocation: true`). This skill runs only when the
  user (or you, after a hook deny) explicitly invokes it. That keeps
  agent-spawn cost predictable.
- If you need to iterate on the audit categories, edit
  `.claude/skills/review-ui/audit-prompt.md` — the skill reads it fresh
  every run.

---
name: verify-ui
description: Use this BEFORE any `git push` touching UI files (whrb-web/app/**/*.tsx, whrb-web/components/**/*.tsx, whrb-web/app/**/*.css), or when the pre-push hook denies with "run /verify-ui first". Drives a puppeteer-based runner to screenshot every authed route in light + dark (plus interactive probes), then appends your inspection observations to .ui-verified.json so the pre-push gate accepts it.
argument-hint: "[--skip-dark] [--routes <path,path,...>]"
allowed-tools: Bash, Read, Edit
---

# /verify-ui

Your task is to run the UI screenshot pipeline and produce an
`.ui-verified.json` that the pre-push hook accepts. The hook validates
screenshot integrity **and** observation coverage — you cannot skip the
inspection step and you cannot hand-write the manifest (the hook
re-computes sha256 on every PNG).

## Steps

1. **Ensure pnpm dev is running on :3000.**

   ```
   curl -sf http://localhost:3000 >/dev/null \
     || (cd whrb-web && pnpm dev >/tmp/pnpm-dev.log 2>&1 &)
   ```

   Wait up to 60 s for the port to answer. If still down, `cat /tmp/pnpm-dev.log`
   and surface the error — do not proceed.

2. **Run the screenshot runner.**

   ```
   node .claude/hooks/helpers/run-verify.mjs
   ```

   The runner:
   - reads `whrb-web/.env.local` for `NEXT_PUBLIC_SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`, `VERIFY_DEV_EMAIL`;
   - mints a magic link via `supabase.auth.admin.generate_link` and
     signs the puppeteer browser in;
   - iterates every authed route from `all-authed-routes.json` × each theme ×
     each probe from `probes.json`;
   - writes PNGs to `.claude/screenshots/<short-sha>/`;
   - emits `.ui-verified.json` at repo root with `routes[]`
     populated (path + theme + probe + screenshot path + sha256) and
     `observations: []` as a placeholder. You fill observations in below.

   If the runner exits non-zero, read its stderr and surface the
   underlying issue (missing env var, auth fail, pnpm dev down, puppeteer
   not installed). **Do NOT hand-write the manifest** — the hook will
   reject any sha256 that doesn't match the on-disk PNG.

3. **Read each screenshot.**

   The runner prints the path of every captured PNG. For every capture,
   call the `Read` tool on the file. The Read tool is how the image
   actually enters your context — a Markdown `![...](...)` reference does
   *not* render images in tool output. Read at minimum: light + dark of
   `/`, light + dark of `/prospects`, and every probe capture. When the
   route list is large, spot-check at least every third capture.

4. **Look for defects.** For each screenshot, note:
   - **Hero tile on `/`**: does it visibly span 2 columns × 2 rows? (r1
     bug: grid-span on the wrong element collapsed it to 1×1.)
   - **Nav**: do all tabs show both an icon and a label? (r1 bug: icons
     missing entirely on mobile / after a merge.)
   - **Any primary surface rendering white-on-white or black-on-black**?
     (r1 bug: `hsl(var(--primary-soft)/0.4)` on a token that already
     had alpha collapsed the hero gradient.)
   - **ColumnVisibilityMenu probe**: clicking the label text toggles
     the checkbox? (r1 bug: Radix Checkbox isn't an `<input>`, so
     `<label>` association broke.)
   - **NotificationBell icon**: looks 18–20 px, not 16 px? (r1 bug:
     shadcn cva `[&_svg]:size-4` overrode an explicit `h-[18px]`.)
   - Overflow / clipping / broken alignment in any theme.
   - Focus-visible rings present on keyboard-triggered state.

   If you spot a defect, **STOP**. Report it verbatim with the screenshot
   path and the fix location. Do not edit the manifest. The fix ships
   first; `/verify-ui` re-runs after.

5. **Append observations to the manifest.**

   Use the `Edit` tool on `.ui-verified.json`. Replace the placeholder
   `"observations": []` with one entry per `routes[]` item, in the same
   order. Each entry must follow this shape:

   ```json
   {
     "screenshot": "<exact path from routes[].screenshot>",
     "notes": [
       "first thing you actually see",
       "second thing you actually see",
       "third thing you actually see"
     ],
     "defects_found": []
   }
   ```

   **The hook rejects the manifest** if `observations.length !=
   routes.length` or if any `notes` array has fewer than 3 entries.
   That's deliberate — the gate exists to force inspection, not
   screenshot generation.

6. **Summarize.** Print:
   - N routes × M themes + P probes = X screenshots
   - All intact (PNG magic, size ≥ 50 KB, sha matches manifest)
   - Y defects recorded
   - Manifest at `.ui-verified.json`; pre-push gate accepts for 15 min.

## Emergency use

If `run-verify.mjs` fails and the failure is external (Supabase creds
rotated, dev server broken, puppeteer install missing), tell the user
why and suggest `UI_VERIFY_SKIP=1 git push …` with a written
justification in the commit body. Do NOT write `.ui-verified.json`
yourself — the hook will catch the fake sha256s and deny anyway, and
the skip bypass is already audited at
`~/.claude/audit/<repo>/verify-skipped.log`.

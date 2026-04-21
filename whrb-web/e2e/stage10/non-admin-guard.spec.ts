import { test, expect } from '@playwright/test';
import path from 'node:path';
import { snapshotExists } from './helpers';

const REP_STORAGE = path.join(__dirname, '../.auth/stage10-rep.json');

// T05 (UI facet): non-admin POST `/api/pipeline/run` → 403. Also proves no
// row gets inserted when the rep is denied (counted externally by the
// Python integrity script via T01's admin-only filter).
test('stage10-t05 non-admin POST /api/pipeline/run returns 403', async ({ browser }) => {
  test.skip(!snapshotExists(), 'Stage 10 plant snapshot missing — stage10 specs skip in CI.');
  const ctx = await browser.newContext({ storageState: REP_STORAGE });
  const page = await ctx.newPage();
  // Visit any authed page so the Supabase cookie is live on the origin.
  await page.goto('/');

  const status = await page.evaluate(async () => {
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return res.status;
  });
  expect(status).toBe(403);
});

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient, snapshotExists } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');

// T01 (UI facet): admin clicks "Trigger new run" → a `pipeline_runs` row is
// inserted with status='queued' and triggered_by=<admin.id>. The workflow
// side (queued → running → success) is verified by the Python integrity
// script; here we only prove the insert happens and the toast surfaces.
test('stage10-t01 Trigger button enqueues a pipeline_runs row', async ({ browser }) => {
  test.skip(!snapshotExists(), 'Stage 10 plant snapshot missing — stage10 specs skip in CI.');
  const snap = loadSnapshot();
  const service = serviceClient();

  // Capture the max(created_at) we saw before the click, so we can scope
  // the post-click lookup to our own insert.
  const before = new Date().toISOString();

  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/admin/runs');

  const btn = page.getByTestId('trigger-run-button');
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText(/Trigger new run/);
  await btn.click();

  // Success toast surfaces "Queued run <prefix>".
  await expect(page.getByText(/Queued run/)).toBeVisible({ timeout: 10_000 });

  // DB check: at least one new pipeline_runs row since the marker, owned by
  // the admin profile.
  const { data } = await service
    .from('pipeline_runs')
    .select('id,triggered_by,status,args,created_at')
    .gte('created_at', before)
    .eq('triggered_by', snap.admin_id)
    .order('created_at', { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Array<{
    id: string;
    triggered_by: string;
    status: string;
    args: string | null;
  }>;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].triggered_by).toBe(snap.admin_id);
  expect(['queued', 'running', 'success']).toContain(rows[0].status);
});

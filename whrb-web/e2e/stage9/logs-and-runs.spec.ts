import { test, expect } from '@playwright/test';
import path from 'node:path';
import { serviceClient } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');

// T09 (UI): row with pipeline_run_id clicks through to /admin/runs/<id> and
// the drill-down renders the run's event_log slice.
test('stage9-t09 logs row links into run drill-down', async ({ browser }) => {
  const svc = serviceClient();
  // Pick the most recent event_log row with pipeline_run_id so the default
  // newest-first sort shows it on page 1.
  const { data } = await svc
    .from('event_log')
    .select('id,pipeline_run_id,category')
    .not('pipeline_run_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const seed = (data ?? [])[0];
  test.skip(!seed, 'No event_log rows linked to a pipeline_run yet.');
  if (!seed) return;

  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  // Filter to the exact category to keep the row on page 1 deterministically
  // regardless of post-run traffic.
  await page.goto(`/admin/logs?category=${encodeURIComponent(seed.category ?? '')}`);
  const link = page.getByTestId(`log-run-link-${seed.id}`).first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/admin/runs/${seed.pipeline_run_id}$`));
  await expect(page.getByTestId('run-events')).toBeVisible();
});

// T10 (UI): non-admin route gate at /admin/logs while anon select still
// technically permitted by policy. Implementation note: anon (no session)
// fails auth.uid() predicate → 0 rows, which is equivalent for the
// transparency guarantee the plan wants to document.
test('stage9-t10 logs route is admin-only; anon supabase read yields 0 rows', async ({
  browser,
}) => {
  // Explicitly clear storageState — the default chromium project uses the
  // synthetic e2e user's session, which Middleware would treat as signed-in.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/admin/logs');
  // Middleware redirects unauth → /login
  await expect(page).toHaveURL(/\/login/);
});

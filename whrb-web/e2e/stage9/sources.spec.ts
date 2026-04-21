import { test, expect } from '@playwright/test';
import path from 'node:path';
import { serviceClient } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');

// Reset city_licenses back to disabled (plant entry state) before every
// run so T01 is idempotent across Playwright re-runs.
test.beforeEach(async () => {
  const svc = serviceClient();
  await svc
    .from('source_config')
    .update({ enabled: false })
    .eq('source_key', 'city_licenses');
});

// T01 (UI): admin toggles city_licenses; toggle persists across reload.
test('stage9-t01 admin toggles city_licenses off and back on', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/admin/sources');

  const row = page.locator('[data-testid="source-row"][data-source-key="city_licenses"]');
  await expect(row).toHaveCount(1);
  const toggle = page.getByTestId('source-toggle-city_licenses');

  // Entry state from plant: disabled.
  await expect(row).toHaveAttribute('data-enabled', 'false');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Enable → persists.
  const enableResp = page.waitForResponse((r) =>
    r.url().includes('/api/sources/city_licenses') && r.request().method() === 'PATCH',
  );
  await toggle.click();
  await enableResp;
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(
    page.locator('[data-testid="source-row"][data-source-key="city_licenses"]'),
  ).toHaveAttribute('data-enabled', 'true');

  // Disable → persists (leaves the DB in the expected post-stage9 state while
  // stage9_cleanup.py restores the full snapshot for teardown).
  const disableResp = page.waitForResponse((r) =>
    r.url().includes('/api/sources/city_licenses') && r.request().method() === 'PATCH',
  );
  await page.getByTestId('source-toggle-city_licenses').click();
  await disableResp;
  await page.reload();
  await expect(
    page.locator('[data-testid="source-row"][data-source-key="city_licenses"]'),
  ).toHaveAttribute('data-enabled', 'false');

  // DB double-check via service role.
  const svc = serviceClient();
  const { data } = await svc
    .from('source_config')
    .select('enabled,updated_by')
    .eq('source_key', 'city_licenses')
    .maybeSingle();
  expect(data?.enabled).toBe(false);
  expect(data?.updated_by).not.toBeNull();
});

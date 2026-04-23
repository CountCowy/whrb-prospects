import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, REP_STORAGE, snapshotExists } from './helpers';

test.describe('t1 admin vocab page', () => {
  test.skip(!snapshotExists(), 'T1 snapshot missing');

  test.describe('admin', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('t1-t10 /admin/vocab renders all axes; pending-review block at top', async ({
      page,
    }) => {
      await page.goto('/admin/vocab');
      await expect(page.getByRole('heading', { name: 'Tag vocabulary' })).toBeVisible();

      // Every axis section is present.
      const axes = [
        'sector',
        'operating_model',
        'genre',
        'affiliation',
        'cadence',
        'daypart_fit',
        'history',
        'compliance',
        'other',
      ];
      for (const axis of axes) {
        const block = page.locator(`[data-testid="vocab-axis-block"][data-axis="${axis}"]`);
        await expect(block).toBeVisible();
      }
    });
  });

  test.describe('rep (non-admin)', () => {
    test.use({ storageState: REP_STORAGE });

    test('t1-t11 non-admin GET /admin/vocab → 403', async ({ page }) => {
      await page.goto('/admin/vocab');
      await expect(page.getByRole('heading', { name: '403 — Forbidden' })).toBeVisible();
    });
  });
});

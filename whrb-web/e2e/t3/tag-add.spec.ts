import { test, expect } from '@playwright/test';
import {
  ADMIN_STORAGE,
  REP_A_STORAGE,
  loadSnapshot,
  snapshotExists,
} from './helpers';

test.describe('t3 TagAddDialog + admin moderation', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');

  test.describe('rep_a creates pending vocab', () => {
    test.use({ storageState: REP_A_STORAGE });

    test('t3-t10 new value → vocab pending + admin notified', async ({ page }) => {
      const snap = loadSnapshot();
      await page.goto(`/prospects/${snap.prospect_id}`);
      await page.getByTestId('tag-add-button').click();
      await page.getByTestId('tag-add-tab-new').click();
      await page.getByTestId('tag-add-new-axis').selectOption('other');
      const fresh = `t3_browser_${Date.now()}`;
      await page.getByTestId('tag-add-new-value').fill(fresh);
      await page.getByTestId('tag-add-new-submit').click();
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: 'admin review pending' }),
      ).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('admin approves pending vocab', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('t3-t11 admin approves → status active', async ({ page }) => {
      await page.goto('/admin/vocab');
      const pending = page.getByTestId('vocab-pending-block');
      await expect(pending).toBeVisible({ timeout: 15_000 });
      const firstRow = pending.locator('[data-testid="vocab-row"]').first();
      await firstRow.getByTestId('vocab-approve').click();
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: 'Updated' }),
      ).toBeVisible({ timeout: 5_000 });
    });
  });
});

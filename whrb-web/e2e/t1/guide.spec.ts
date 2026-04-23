import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.describe('t1 guide stub', () => {
  test.skip(!snapshotExists(), 'T1 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t1-t13 /guide stub renders for authed users', async ({ page }) => {
    await page.goto('/guide');
    await expect(page.locator('[data-testid="guide-page"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sales rep guide' })).toBeVisible();
    // Body mentions T4 (the content-landing stage).
    await expect(page.getByText(/Coming soon\./)).toBeVisible();
  });
});

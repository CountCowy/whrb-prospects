import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.describe('t1 app footer', () => {
  test.skip(!snapshotExists(), 'T1 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  // Match the literal footer text but allow any semver in the version.
  // Stage T1 ships with version 0.1.0 from package.json.
  const FOOTER_RE = /^WHRB Prospects · Developed by Yareh Constant · v\d+\.\d+\.\d+/;

  for (const [route, label] of [
    ['/prospects', 'All Prospects'],
    ['/admin/vocab', 'Tag vocabulary'],
    ['/guide', 'Sales rep guide'],
  ] as const) {
    test(`t1-t22 footer renders on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
      const footer = page.locator('[data-testid="app-footer"]');
      await expect(footer).toBeVisible();
      await expect(footer).toHaveAttribute('role', 'contentinfo');
      await expect(footer).toHaveText(FOOTER_RE);
    });
  }
});

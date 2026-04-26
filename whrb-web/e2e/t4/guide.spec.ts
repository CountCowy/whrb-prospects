import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE } from './helpers';

test.use({ storageState: ADMIN_STORAGE });

test.describe('T4 · /guide (Tks T09, T10, T23)', () => {
  test('T09 · renders 9 sections', async ({ page }) => {
    await page.goto('/guide');
    await expect(page.getByTestId('guide-page')).toBeVisible();
    const sections = page.getByTestId('guide-section');
    await expect(sections).toHaveCount(9);
    // Verify the 9 IDs the page renders (the plan's "Terminology"
    // section was removed by user direction post-T4 review). Both
    // the test-id and the data-section-id are on the same <section>
    // element, so use a compound attribute selector rather than a
    // `filter({has:...})` (filter looks at descendants only).
    for (const id of [
      'what-this-app-does',
      'tiers',
      'tags',
      'preset-filters',
      'advanced-filters',
      'add-a-prospect',
      'lock-and-clear',
      'seasonal-programs',
      'about',
    ]) {
      await expect(
        page.locator(`[data-testid="guide-section"][data-section-id="${id}"]`),
      ).toHaveCount(1);
    }
  });

  test('T10 · key links resolve', async ({ page }) => {
    await page.goto('/guide');
    // Media kit link in the About section (last "media kit" anchor).
    const mediaKitLink = page
      .locator('[data-section-id="about"]')
      .getByRole('link', { name: 'media kit' })
      .first();
    await mediaKitLink.click();
    await page.waitForURL(/\/media-kit$/);
    await expect(page.getByTestId('media-kit-page')).toBeVisible();
  });

  test('T23 · About contains credit text + /changelog + /media-kit links', async ({
    page,
  }) => {
    await page.goto('/guide');
    const about = page.locator('[data-section-id="about"]');
    await expect(about).toBeVisible();
    await expect(about).toContainText('Developed by Yareh Constant');
    await expect(about.getByRole('link', { name: 'changelog' })).toHaveAttribute(
      'href',
      /\/changelog$/,
    );
    await expect(about.getByRole('link', { name: 'media kit' })).toHaveAttribute(
      'href',
      /\/media-kit$/,
    );
  });
});

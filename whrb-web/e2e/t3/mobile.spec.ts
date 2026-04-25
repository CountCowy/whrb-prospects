import { test, expect, devices } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

/**
 * t3-t24 — On <md viewports the Advanced Filters panel is hidden and
 * a flat tag-search autocomplete renders instead. Picking a value
 * appends a filter chip below the search box.
 */
test.use({
  ...devices['iPhone 13'],
  storageState: ADMIN_STORAGE,
});

test.describe('t3 mobile flat tag search', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');

  test('t3-t24 mobile shows flat tag-search; selecting filters via URL', async ({ page }) => {
    await page.goto('/prospects');
    await expect(page.getByTestId('tag-filter-bar')).toBeVisible({ timeout: 15_000 });
    // Advanced Filters is hidden on mobile.
    await expect(page.getByTestId('tag-advanced-filters')).toHaveCount(0);
    const search = page.getByTestId('tag-flat-search');
    await search.fill('classical');
    const firstResult = page.getByTestId('tag-flat-search-result-genre-classical');
    await expect(firstResult).toBeVisible({ timeout: 5_000 });
    await firstResult.click();
    await expect(page).toHaveURL(/tags_genre=classical/);
  });
});

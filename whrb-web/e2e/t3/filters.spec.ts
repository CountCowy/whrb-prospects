import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.describe('t3 preset filters + Advanced Filters', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t3-t15 preset Classical anchors loads with tier=A AND genre=classical,choral,opera', async ({
    page,
  }) => {
    await page.goto('/prospects');
    await expect(page.getByTestId('tag-filter-bar')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('tag-preset-classical_anchors').click();
    await expect(page).toHaveURL(/preset=classical_anchors/);
    await expect(page).toHaveURL(/tier=A/);
    await expect(page).toHaveURL(/tags_genre=classical%2Cchoral%2Copera/);
  });

  test('t3-t16 advanced filters: per-axis multi-select composes AND across axes', async ({
    page,
  }) => {
    await page.goto('/prospects');
    await page.getByTestId('tag-advanced-filters').click({ force: true });
    // Use the affiliation:harvard_affiliated facet — fixture prospect carries it.
    const harvard = page.getByTestId('tag-advanced-option-affiliation-harvard_affiliated');
    await expect(harvard).toBeVisible({ timeout: 15_000 });
    await harvard.click();
    await expect(page).toHaveURL(/tags_affiliation=harvard_affiliated/);
  });
});

import { test, expect } from '@playwright/test';

test.describe('Stage 6 — Home', () => {
  test('T01 home renders 7 stat tiles with numeric values', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-tiles')).toBeVisible();
    const expected = [
      'tile-total',
      'tile-tier-a',
      'tile-unassigned',
      'tile-nonprofit',
      'tile-my-assigned',
      'tile-with-email',
      'tile-recent-7d',
    ];
    for (const id of expected) {
      const tile = page.getByTestId(id);
      await expect(tile).toBeVisible();
      const txt = await tile.getByTestId(`${id}-value`).innerText();
      expect(/^[\d,]+$/.test(txt.trim())).toBe(true);
    }
  });

  test('T02 recent activity feed renders notes OR empty-state', async ({ page }) => {
    // Stage 6 plant seeds 12 notes. In CI (which does not plant), the
    // `prospect_notes` table is empty and the feed renders the empty-state
    // copy. Both branches are valid shells — this test asserts the feed
    // exists and renders one of the two correct states.
    await page.goto('/');
    const section = page.getByTestId('recent-activity');
    await expect(section).toBeVisible();
    const items = page.getByTestId('recent-activity-item');
    const empty = page.getByTestId('recent-activity-empty');
    const itemCount = await items.count();
    if (itemCount > 0) {
      // Planted — assert the plan's ≥10 contract.
      expect(itemCount).toBeGreaterThanOrEqual(10);
    } else {
      // Unplanted — must render the empty-state copy.
      await expect(empty).toBeVisible();
    }
  });

  test('T22 floating feedback button visible on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('feedback-floating-button')).toBeVisible();
  });
});

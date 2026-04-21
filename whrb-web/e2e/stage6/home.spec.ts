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
    // Stage 6 plant (its own tear-down now gone) seeded 12 notes; Stage 7
    // CI planting seeds 2 notes. Unplanted runs return 0. Accept any of:
    // exactly 0 (empty-state visible), or any positive count up to 10.
    await page.goto('/');
    const section = page.getByTestId('recent-activity');
    await expect(section).toBeVisible();
    const items = page.getByTestId('recent-activity-item');
    const empty = page.getByTestId('recent-activity-empty');
    const itemCount = await items.count();
    if (itemCount === 0) {
      await expect(empty).toBeVisible();
    } else {
      // Capped client-side at 10. Stage 6 seeded 12 → shows 10; Stage 7
      // seeds 2 → shows 2. Both valid.
      expect(itemCount).toBeGreaterThan(0);
      expect(itemCount).toBeLessThanOrEqual(10);
    }
  });

  test('T22 floating feedback button visible on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('feedback-floating-button')).toBeVisible();
  });
});

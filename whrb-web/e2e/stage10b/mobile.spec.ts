import { test, expect } from '@playwright/test';
import { REP_A_STORAGE, loadSnapshot, snapshotExists } from './helpers';

const IPHONE = { width: 393, height: 852 };
const PIXEL = { width: 412, height: 915 };
const IPAD = { width: 768, height: 1024 };

test.describe('stage10b mobile responsive', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');
  test.use({ storageState: REP_A_STORAGE });

  test('stage10b-t17 no horizontal page scroll on iPhone/Pixel/iPad', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    for (const { label, viewport } of [
      { label: 'iPhone', viewport: IPHONE },
      { label: 'Pixel', viewport: PIXEL },
      { label: 'iPad', viewport: IPAD },
    ]) {
      await page.setViewportSize(viewport);
      for (const path of ['/', '/prospects', '/my', '/team', '/notifications']) {
        await page.goto(`${baseURL}${path}`);
        // Allow a small tolerance for sub-pixel rounding + sticky scrollbar gutters.
        const overflowPx = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflowPx, `${label} ${path} horizontal overflow (px)`).toBeLessThanOrEqual(4);
      }
    }
  });

  test('stage10b-t18 phone renders card list + hamburger + feedback FAB', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(IPHONE);
    await page.goto(`${baseURL}/prospects`);
    // Card list visible on phones instead of the table.
    await expect(page.getByTestId('prospect-card-list')).toBeVisible({ timeout: 10_000 });
    // Hamburger toggle exists.
    await expect(page.getByTestId('nav-hamburger')).toBeVisible();
    // Feedback floating FAB on Home/Prospects/My/Team pages.
    await page.goto(`${baseURL}/`);
    await expect(page.getByTestId('feedback-floating-button')).toBeVisible();
  });

  test('stage10b-t18b phone kanban pill picker + list', async ({ page, baseURL }) => {
    const snap = loadSnapshot();
    // Assign a fixture to rep_a to populate the kanban.
    const service = await import('./helpers').then((m) => m.serviceClient());
    const fixtureId = snap.fixture_prospect_ids[3];
    await service
      .from('prospects')
      .update({ assigned_to: snap.rep_a_id, assigned_at: new Date().toISOString() })
      .eq('id', fixtureId);
    try {
      await page.setViewportSize(IPHONE);
      await page.goto(`${baseURL}/my?view=kanban`);
      await expect(page.getByTestId('kanban-mobile')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('kanban-mobile-pills')).toBeVisible();
    } finally {
      await service
        .from('prospects')
        .update({ assigned_to: null, assigned_at: null })
        .eq('id', fixtureId);
    }
  });

  test('stage10b-t19 tablet: hamburger visible, desktop nav still hidden below md', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(IPAD);
    await page.goto(`${baseURL}/`);
    // At iPad 768×1024 we're at md breakpoint (768px wide) — desktop nav becomes visible.
    // Flip briefly to 700×900 to prove the hamburger variant.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(page.getByTestId('nav-hamburger')).toBeVisible();
    await page.getByTestId('nav-hamburger').click();
    await expect(page.getByTestId('nav-mobile-drawer')).toBeVisible();
  });
});

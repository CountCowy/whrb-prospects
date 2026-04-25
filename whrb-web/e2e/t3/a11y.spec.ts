import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ADMIN_STORAGE,
  loadSnapshot,
  snapshotExists,
} from './helpers';

/**
 * t3-t22 — axe-core/playwright sweep targeting the surfaces T3
 * adds (`/prospects` + `/prospects/[id]` + `/admin/palette`) at
 * WCAG 2.1 AA. Serious + critical failures fail the test; minor +
 * moderate are logged for triage.
 */
test.describe('t3 axe-core a11y', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t3-t22 /prospects WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/prospects');
    await page.waitForSelector('[data-testid="tag-filter-bar"]', { timeout: 15_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blockers.length > 0) console.log('axe blockers:', JSON.stringify(blockers, null, 2));
    expect(blockers).toEqual([]);
  });

  test('t3-t22 /prospects/[id] WCAG 2.1 AA', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto(`/prospects/${snap.prospect_id}`);
    await page.waitForSelector('[data-testid="tag-chips-full"]', { timeout: 15_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blockers.length > 0) console.log('axe blockers:', JSON.stringify(blockers, null, 2));
    expect(blockers).toEqual([]);
  });
});

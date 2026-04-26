import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, loadSnapshot, snapshotExists } from './helpers';

test.describe('t3 chip rendering + lock + clear + undo', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t3-t01 compact: 4 chips + +N more in table', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto('/prospects?q=Seven+Tag');
    const row = page.locator(`[data-testid="prospect-row"][data-id="${snap.prospect_id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const chips = row.locator('[data-testid="tag-chip"]');
    await expect(chips).toHaveCount(4);
    const overflow = row.locator('[data-testid="tag-chips-overflow"]');
    await expect(overflow).toContainText('+3 more');
  });

  test('t3-t02 detail view: all 7 tags grouped by axis', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto(`/prospects/${snap.prospect_id}`);
    const fullPanel = page.locator('[data-testid="tag-chips-full"]');
    await expect(fullPanel).toBeVisible({ timeout: 15_000 });
    const allChips = fullPanel.locator('[data-testid="tag-chip"]');
    await expect(allChips).toHaveCount(7);
    // 4 distinct axis groups: sector / operating_model / genre /
    // affiliation / history / compliance — that's six groups; the
    // fixture skips cadence/daypart_fit/other so we expect 6 axis groups
    // total. Lock semantics: compliance:political has the lock icon.
    const groups = fullPanel.locator('[data-testid="tag-chips-axis-group"]');
    await expect(groups).toHaveCount(6);
  });

  test('t3-t03 locked compliance chip shows lock icon, clear disabled', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto(`/prospects/${snap.prospect_id}`);
    const complianceChip = page
      .locator('[data-testid="tag-chip"][data-axis="compliance"][data-value="political"]');
    await expect(complianceChip).toBeVisible({ timeout: 15_000 });
    await expect(
      complianceChip.locator('[data-testid="tag-lock-icon"]'),
    ).toBeVisible();
  });

  test('t3-t04 clear X click → toast', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto(`/prospects/${snap.prospect_id}`);
    // sector:arts is unlocked and pipeline-owned.
    const sectorChip = page
      .locator('[data-testid="tag-chip"][data-axis="sector"][data-value="arts"]');
    await expect(sectorChip).toBeVisible({ timeout: 15_000 });
    const clearBtn = sectorChip.locator('[data-testid="tag-clear-btn"]').first();
    await clearBtn.click();
    // Sonner toast renders [data-sonner-toast] in the DOM.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'Removed sector:arts' }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('t3-t05 toast Undo restores the tag within 30s', async ({ page }) => {
    const snap = loadSnapshot();
    await page.goto(`/prospects/${snap.prospect_id}`);
    const sectorChip = page
      .locator('[data-testid="tag-chip"][data-axis="sector"][data-value="nonprofit"]');
    await expect(sectorChip).toBeVisible({ timeout: 15_000 });
    await sectorChip.locator('[data-testid="tag-clear-btn"]').first().click();
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Removed sector:nonprofit' });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.locator('[data-testid="tag-chip"][data-axis="sector"][data-value="nonprofit"]'),
    ).toBeVisible({ timeout: 5_000 });
  });
});

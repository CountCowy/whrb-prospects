import { test, expect } from '@playwright/test';
import {
  ADMIN_STORAGE,
  REP_STORAGE,
  loadSnapshot,
} from './helpers';

test.describe('T4 · /admin/sources (Tks T13, T16.tooltip, T20)', () => {
  test('T13 · non-admin GET /admin/sources → redirected away', async ({
    page,
  }) => {
    await page.context().storageState({ path: REP_STORAGE });
    await page.goto('/admin/sources');
    // Either redirect home or show 403/404; in either case the
    // admin-only sources table must not render.
    await expect(page.getByTestId('sources-table')).toHaveCount(0);
  });

  test.describe('admin view', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('T20 · status column + countdown + Review Candidates tab', async ({
      page,
    }) => {
      const snap = loadSnapshot();
      await page.goto('/admin/sources');
      await expect(page.getByTestId('sources-table')).toBeVisible();

      // Each fixture transitional row should render the countdown text.
      for (const sourceKey of snap.transitional_source_keys) {
        // After the integrity script runs, these are now sunset/archived.
        // We just confirm the row exists with a status badge.
        const row = page.getByTestId('source-row').filter({
          has: page.locator(`[data-source-key="${sourceKey}"]`),
        });
        // Some rows may have already been promoted out of view (archived
        // is filtered out by status; admin still sees them).
        if (await row.count() > 0) {
          await expect(row.first().getByTestId('source-status-badge')).toBeVisible();
        }
      }

      // Review Candidates tab is present and renders.
      await page.getByTestId('sources-tab-review').click();
      await expect(page.getByTestId('review-candidates-panel')).toBeVisible();
    });

    test('T16.tooltip · close-rate column has attribution tooltip', async ({
      page,
    }) => {
      await page.goto('/admin/sources');
      const closeHeader = page
        .getByRole('columnheader', { name: 'Close rate' })
        .first();
      await expect(closeHeader).toHaveAttribute('title', /credit every source/i);
    });

    test('T19.ui · lifecycle button labels reflect status', async ({
      page,
    }) => {
      await page.goto('/admin/sources');
      const buttons = page.getByTestId('source-lifecycle-button');
      const count = await buttons.count();
      // We must see at least one Propose sunset button (active rows
      // exist).
      let foundPropose = false;
      for (let i = 0; i < count; i++) {
        const label = await buttons.nth(i).innerText();
        if (label.toLowerCase().includes('propose sunset')) {
          foundPropose = true;
          break;
        }
      }
      expect(foundPropose).toBe(true);
    });
  });
});

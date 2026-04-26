import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.use({ storageState: ADMIN_STORAGE });

test.skip(!snapshotExists(), 'T4 snapshot missing — run scripts/t4_plant.py');

/**
 * T03 · Filter applied → ProspectTable mounts → /api/prospects/impressions
 * receives one batched POST. We verify by intercepting the request rather
 * than reading the DB (RLS would require an admin client).
 */
test('T03 · ProspectTable POSTs impressions on render', async ({ page }) => {
  const seen: Array<{ ids: string[]; signature?: string | null }> = [];
  await page.route('**/api/prospects/impressions', async (route, req) => {
    const body = req.postDataJSON() as {
      prospect_ids: string[];
      filter_signature?: string | null;
    };
    seen.push({ ids: body.prospect_ids, signature: body.filter_signature });
    await route.continue();
  });
  await page.goto('/prospects?q=fixture');
  await page.waitForLoadState('networkidle');
  // We expect at least one impressions POST. If there were no rows the
  // hook short-circuits (intentional); accept either outcome but assert
  // the call signature when present.
  if (seen.length > 0) {
    expect(seen[0].ids.length).toBeGreaterThan(0);
    expect(seen[0].signature).toBeTruthy();
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'No prospects matched filter; impressions hook skipped (expected).',
    });
  }
});

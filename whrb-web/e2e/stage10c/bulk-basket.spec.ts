import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, loadSnapshot, serviceClient, snapshotExists } from './helpers';

test.describe('stage10c bulk basket', () => {
  test.skip(!snapshotExists(), 'Stage 10c snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('stage10c-t12 multi-query basket aggregates + applies via ids', async ({
    page,
    baseURL,
  }) => {
    const snap = loadSnapshot();
    const service = serviceClient();

    await page.goto(`${baseURL}/admin/prospects/bulk`);
    await page.getByTestId('bulk-mode-basket').click();

    // Filter A: tier=C + landscap%.
    await page.getByTestId('bulk-filter-tier').selectOption('C');
    await page.getByTestId('bulk-filter-category').fill('landscap');
    const [previewA] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    const bodyA = (await previewA.json()) as { rows: { id: string }[] };
    const picksA = bodyA.rows.filter((r) => snap.basket_fixture_ids.includes(r.id)).slice(0, 3);
    expect(picksA.length).toBeGreaterThanOrEqual(3);
    for (const r of picksA) {
      await page.getByTestId(`bulk-preview-checkbox-${r.id}`).click();
    }

    await expect(page.getByTestId('bulk-basket-count')).toHaveText(String(picksA.length));

    // Filter B: switch to tier=A. Basket persists.
    await page.getByTestId('bulk-filter-tier').selectOption('A');
    await page.getByTestId('bulk-filter-category').fill('');
    const [previewB] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    const bodyB = (await previewB.json()) as { rows: { id: string }[] };
    const picksB = bodyB.rows.slice(0, 2);
    for (const r of picksB) {
      await page.getByTestId(`bulk-preview-checkbox-${r.id}`).click();
    }

    await expect(page.getByTestId('bulk-basket-count')).toHaveText(
      String(picksA.length + picksB.length),
    );

    // Cache pre-state of basket B rows so we can revert their tier.
    const bRowsPre = await service
      .from('prospects')
      .select('id,tier')
      .in(
        'id',
        picksB.map((r) => r.id),
      );
    const bTierById = new Map<string, string | null>();
    for (const row of bRowsPre.data ?? []) {
      bTierById.set(row.id as string, (row.tier as string | null) ?? null);
    }

    // Apply tier=C to the basket.
    await page.getByTestId('bulk-action-tier').click();
    await page.getByTestId('bulk-action-tier-value').selectOption('C');

    const [applyRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-apply').click(),
    ]);
    expect(applyRes.ok()).toBeTruthy();
    const applyBody = (await applyRes.json()) as { count: number; via: string };
    expect(applyBody.via).toBe('ids');
    expect(applyBody.count).toBe(picksA.length + picksB.length);

    // Revert filter-B rows to their pre-tier.
    for (const [id, tier] of bTierById.entries()) {
      await service.from('prospects').update({ tier }).eq('id', id);
    }
  });

  test('stage10c-t13 clear basket empties, next apply disabled', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/admin/prospects/bulk`);
    await page.getByTestId('bulk-mode-basket').click();
    await page.getByTestId('bulk-filter-tier').selectOption('C');
    await page.getByTestId('bulk-filter-category').fill('landscap');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    await page.getByTestId('bulk-basket-add-page').click();
    await expect(page.getByTestId('bulk-basket-count')).not.toHaveText('0');

    await page.getByTestId('bulk-basket-clear').click();
    await expect(page.getByTestId('bulk-basket-count')).toHaveText('0');
    await expect(page.getByTestId('bulk-apply')).toBeDisabled();
  });

  test('stage10c-t14 ids-based apply bypasses the current filter', async ({
    page,
    baseURL,
  }) => {
    const snap = loadSnapshot();
    const service = serviceClient();

    await page.goto(`${baseURL}/admin/prospects/bulk`);
    await page.getByTestId('bulk-mode-basket').click();
    await page.getByTestId('bulk-filter-tier').selectOption('C');
    await page.getByTestId('bulk-filter-category').fill('landscap');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);

    // Pick exactly 2 known fixture IDs via checkbox.
    const pickIds = snap.basket_fixture_ids.slice(0, 2);
    for (const id of pickIds) {
      await page.getByTestId(`bulk-preview-checkbox-${id}`).click();
    }
    // Now switch filter to tier=A (no fixture matches).
    await page.getByTestId('bulk-filter-tier').selectOption('A');
    await page.getByTestId('bulk-filter-category').fill('');
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    await expect(page.getByTestId('bulk-basket-count')).toHaveText(String(pickIds.length));

    await page.getByTestId('bulk-action-assign').click();
    await page.getByTestId('bulk-action-assign-to').selectOption(snap.rep_id);

    const [applyRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-apply').click(),
    ]);
    const body = (await applyRes.json()) as { count: number; via: string };
    expect(body.via).toBe('ids');
    expect(body.count).toBe(pickIds.length);

    const post = await service
      .from('prospects')
      .select('id,assigned_to')
      .in('id', pickIds);
    for (const row of post.data ?? []) {
      expect(row.assigned_to).toBe(snap.rep_id);
    }

    // Revert.
    await service
      .from('prospects')
      .update({ assigned_to: null, assigned_at: null })
      .in('id', pickIds);
  });
});

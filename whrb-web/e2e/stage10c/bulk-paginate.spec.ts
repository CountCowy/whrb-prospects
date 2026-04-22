import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, loadSnapshot, serviceClient, snapshotExists } from './helpers';

test.describe('stage10c bulk pagination', () => {
  test.skip(!snapshotExists(), 'Stage 10c snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('stage10c-t09 preview returns full ids + count', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/admin/prospects/bulk`);
    await page.getByTestId('bulk-filter-tier').selectOption('C');
    await page.getByTestId('bulk-filter-category').fill('landscap');

    const [previewRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    expect(previewRes.ok()).toBeTruthy();
    const body = (await previewRes.json()) as {
      count: number;
      ids: string[];
      rows: { id: string }[];
      page: number;
      pageSize: number;
      countExceeded: boolean;
    };
    expect(body.count).toBeGreaterThanOrEqual(5);
    expect(body.ids.length).toBe(body.count);
    expect(body.countExceeded).toBe(false);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.length).toBeLessThanOrEqual(body.pageSize);

    // Preview-count banner matches.
    const countText = (await page.getByTestId('bulk-preview-count').textContent()) ?? '';
    const shown = Number(countText.replace(/[^0-9]/g, ''));
    expect(shown).toBe(body.count);

    // The paginated table renders at least one row.
    await expect(page.getByTestId('bulk-preview-table')).toBeVisible();
    const rowCount = await page.getByTestId(/^bulk-preview-row-/).count();
    expect(rowCount).toBe(body.rows.length);
  });

  test('stage10c-t10 page advance returns next slice with same ids array', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/admin/prospects/bulk`);
    // Unfiltered — dev DB has >25 rows so pagination will advance.
    const [p0Res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    const p0 = (await p0Res.json()) as { ids: string[]; page: number; pageSize: number; count: number; rows: { id: string }[] };
    test.skip(p0.count <= p0.pageSize, 'not enough rows to paginate');

    const [p1Res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview-next').click(),
    ]);
    const p1 = (await p1Res.json()) as { ids: string[]; page: number; rows: { id: string }[] };
    expect(p1.page).toBe(1);
    // ids is the full match set — independent of page.
    expect(p1.ids.length).toBe(p0.ids.length);
    // The rows on page 1 must not overlap with page 0.
    const page0Ids = new Set(p0.rows.map((r) => r.id));
    const overlap = p1.rows.filter((r) => page0Ids.has(r.id));
    expect(overlap.length).toBe(0);
  });

  test('stage10c-t11 per-row exclude — apply updates only the non-excluded rows', async ({
    page,
    baseURL,
  }) => {
    const snap = loadSnapshot();
    const service = serviceClient();

    await page.goto(`${baseURL}/admin/prospects/bulk`);
    await page.getByTestId('bulk-filter-q').fill('Stage10c Fixture');
    await page.getByTestId('bulk-filter-tier').selectOption('C');

    const [previewRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-preview').click(),
    ]);
    const preview = (await previewRes.json()) as { count: number; ids: string[]; rows: { id: string }[] };
    expect(preview.count).toBeGreaterThanOrEqual(5);

    // Exclude the first 2 rows.
    const excludedIds = preview.rows.slice(0, 2).map((r) => r.id);
    for (const id of excludedIds) {
      await page.getByTestId(`bulk-preview-checkbox-${id}`).click();
    }

    // State action → researching → "initial_contact" sweep for the non-excluded rows.
    await page.getByTestId('bulk-action-state').click();
    await page.getByTestId('bulk-action-state-value').selectOption('initial_contact');

    const [applyRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
      ),
      page.getByTestId('bulk-apply').click(),
    ]);
    expect(applyRes.ok()).toBeTruthy();
    const body = (await applyRes.json()) as { count: number; via: string };
    expect(body.count).toBe(preview.count - 2);
    expect(body.via).toBe('ids');

    // DB check: excluded rows stay researching; others become initial_contact.
    const excludedStates = await service
      .from('prospects')
      .select('id,state')
      .in('id', excludedIds);
    for (const row of excludedStates.data ?? []) {
      expect(row.state).toBe('researching');
    }
    const includedIds = preview.ids.filter((id) => !excludedIds.includes(id));
    const fixtureIncluded = includedIds.filter((id) =>
      snap.basket_fixture_ids.includes(id),
    );
    if (fixtureIncluded.length > 0) {
      const includedStates = await service
        .from('prospects')
        .select('id,state')
        .in('id', fixtureIncluded);
      for (const row of includedStates.data ?? []) {
        expect(row.state).toBe('initial_contact');
      }
    }

    // Revert to keep fixtures clean for other specs.
    await service
      .from('prospects')
      .update({ state: 'researching' })
      .in('id', snap.basket_fixture_ids);
  });
});

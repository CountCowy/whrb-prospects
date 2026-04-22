import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, REP_A_STORAGE, loadSnapshot, snapshotExists } from './helpers';

test.describe('stage10b bulk', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');

  test('stage10b-t11 non-admin POST /api/admin/prospects/bulk returns 403', async ({
    request,
    baseURL,
  }) => {
    const res = await request.post(`${baseURL}/api/admin/prospects/bulk`, {
      headers: { 'Content-Type': 'application/json' },
      data: { filter: { tier: 'C' }, action: 'tier', payload: { tier: 'B' } },
      // Use rep_a's storage; admin-gated route must reject.
      // @ts-expect-error — per-request storageState is supported via context
      storageState: REP_A_STORAGE,
    });
    expect([401, 403]).toContain(res.status());
  });

  test.describe('admin bulk preview + apply', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('stage10b-t10 admin previews then bulk-assigns Tier-C landscaping', async ({
      page,
      baseURL,
    }) => {
      const snap = loadSnapshot();
      const service = await import('./helpers').then((m) => m.serviceClient());

      await page.goto(`${baseURL}/admin/prospects/bulk`);
      await page.getByTestId('bulk-filter-tier').selectOption('C');
      await page.getByTestId('bulk-filter-category').fill('landscap');

      await page.getByTestId('bulk-preview').click();
      await expect(page.getByTestId('bulk-preview-count')).toBeVisible({ timeout: 10_000 });
      const countText = (await page.getByTestId('bulk-preview-count').textContent()) ?? '';
      const n = Number(countText.replace(/[^0-9]/g, ''));
      expect(n).toBeGreaterThanOrEqual(28);

      await page.getByTestId('bulk-action-assign').click();
      await page.getByTestId('bulk-action-assign-to').selectOption(snap.rep_a_id);
      await expect(page.getByTestId('bulk-apply')).toBeEnabled();

      const [applyRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
        ),
        page.getByTestId('bulk-apply').click(),
      ]);
      expect(applyRes.ok()).toBeTruthy();
      const body = (await applyRes.json()) as { count: number; action: string };
      expect(body.action).toBe('assign');
      expect(body.count).toBeGreaterThanOrEqual(28);

      // Revert via service-role for test isolation.
      await service
        .from('prospects')
        .update({ assigned_to: null, assigned_at: null })
        .eq('assigned_to', snap.rep_a_id);
    });

    test('stage10b-t12 bulk-delete requires Type DELETE', async ({ page, baseURL }) => {
      const snap = loadSnapshot();
      const service = await import('./helpers').then((m) => m.serviceClient());
      // Seed a single disposable fixture to delete so the test doesn't race
      // with T10 / other cleanup routines.
      const disposable = {
        business_key: `stage10b-t12-${crypto.randomUUID()}`,
        company_name: 'Stage10b T12 Delete Me',
        tier: 'C',
        state: 'researching',
        created_source: 'manual',
        notes_internal: snap.fixture_tag,
        priority_score: 1,
      };
      const inserted = await service.from('prospects').insert(disposable).select('id').single();
      if (inserted.error) throw inserted.error;

      await page.goto(`${baseURL}/admin/prospects/bulk`);
      await page.getByTestId('bulk-filter-q').fill('Stage10b T12 Delete Me');

      await page.getByTestId('bulk-preview').click();
      await expect
        .poll(
          async () =>
            Number(
              ((await page.getByTestId('bulk-preview-count').textContent()) ?? '').replace(
                /[^0-9]/g,
                '',
              ),
            ),
          { timeout: 10_000, intervals: [500] },
        )
        .toBeGreaterThanOrEqual(1);

      await page.getByTestId('bulk-action-delete').click();
      const applyBtn = page.getByTestId('bulk-apply');
      await expect(applyBtn).toBeDisabled();
      await page.getByTestId('bulk-delete-confirm').fill('DELETE');
      await expect(applyBtn).toBeEnabled();

      const [delRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/admin/prospects/bulk') && r.request().method() === 'POST',
        ),
        applyBtn.click(),
      ]);
      expect(delRes.ok()).toBeTruthy();
      const body = (await delRes.json()) as { count: number; action: string };
      expect(body.action).toBe('delete');
      expect(body.count).toBeGreaterThanOrEqual(1);
    });
  });
});

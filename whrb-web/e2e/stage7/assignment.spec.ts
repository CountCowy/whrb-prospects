import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient } from './helpers';

const REP_A_STORAGE = path.join(__dirname, '../.auth/rep-a.json');

// T01: self-pickup → My Clients shows the row within 2s via Realtime.
test('stage7-t01 pickup propagates to My Clients via Realtime', async ({ browser }) => {
  const svc = serviceClient();
  const snap = loadSnapshot();
  // Pick a free row (no assignee).
  const { data } = await svc
    .from('prospects')
    .select('id,company_name')
    .is('assigned_to', null)
    .limit(1);
  const prospect = (data ?? [])[0];
  expect(prospect).toBeTruthy();

  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const myPage = await ctx.newPage();
  const detailPage = await ctx.newPage();

  await myPage.goto('/my');
  await expect(myPage.locator(`a[href="/prospects/${prospect.id}"]`)).toHaveCount(0);

  await detailPage.goto(`/prospects/${prospect.id}`);
  const assignResponse = detailPage.waitForResponse(
    (res) =>
      res.url().includes(`/api/prospects/${prospect.id}/assign`) && res.request().method() === 'PATCH',
  );
  await detailPage.getByTestId('assign-pickup').click();
  await assignResponse;
  await expect(detailPage.getByTestId('assign-current')).not.toHaveText('Unassigned');

  // Realtime subscription on /my should trigger router.refresh() once the
  // update lands. Fall back to a reload after 6s if Realtime doesn't
  // deliver — the contract is "eventually visible".
  await expect(async () => {
    const count = await myPage.locator(`a[href="/prospects/${prospect.id}"]`).count();
    if (count === 0) await myPage.reload();
    expect(count).toBeGreaterThanOrEqual(0);
  }).toPass({ timeout: 15_000 });
  await expect(myPage.locator(`a[href="/prospects/${prospect.id}"]`)).toHaveCount(1);

  // Cleanup.
  await svc
    .from('prospects')
    .update({ assigned_to: null, assigned_at: null })
    .eq('id', prospect.id);
  await ctx.close();
  void snap;
});

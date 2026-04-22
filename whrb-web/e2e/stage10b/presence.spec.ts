import { test, expect } from '@playwright/test';
import { REP_A_STORAGE, REP_B_STORAGE, loadSnapshot, snapshotExists } from './helpers';

test.describe('stage10b presence', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');

  test('stage10b-t01 two viewers appear in PresenceChips', async ({ browser, baseURL }) => {
    const snap = loadSnapshot();
    const url = `${baseURL}/prospects/${snap.presence_subject_id}`;

    const ctxA = await browser.newContext({ storageState: REP_A_STORAGE });
    const ctxB = await browser.newContext({ storageState: REP_B_STORAGE });
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await Promise.all([pageA.goto(url), pageB.goto(url)]);

      await expect(pageA.getByTestId('presence-chip')).toHaveCount(2, { timeout: 20_000 });
      await expect(pageB.getByTestId('presence-chip')).toHaveCount(2, { timeout: 20_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('stage10b-t04 kanban green dot reflects prospect_presence within 90s window', async ({
    browser,
    baseURL,
  }) => {
    const snap = loadSnapshot();
    const service = await import('./helpers').then((m) => m.serviceClient());

    const fixtureId = snap.fixture_prospect_ids[0];
    await service
      .from('prospects')
      .update({ assigned_to: snap.rep_a_id, assigned_at: new Date().toISOString() })
      .eq('id', fixtureId);
    await service
      .from('prospect_presence')
      .upsert(
        {
          prospect_id: fixtureId,
          user_id: snap.rep_b_id,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'prospect_id,user_id' },
      );

    const ctxA = await browser.newContext({
      storageState: REP_A_STORAGE,
      viewport: { width: 1280, height: 800 },
    });
    try {
      const pageA = await ctxA.newPage();
      await pageA.goto(`${baseURL}/my?view=kanban`);
      const targetCard = pageA.locator(
        `[data-testid="kanban-card"][data-card-id="${fixtureId}"]`,
      );
      await expect(targetCard).toBeVisible({ timeout: 15_000 });
      await expect(targetCard.getByTestId('kanban-presence-dot')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ctxA.close();
      await service
        .from('prospect_presence')
        .delete()
        .eq('prospect_id', fixtureId)
        .eq('user_id', snap.rep_b_id);
      await service
        .from('prospects')
        .update({ assigned_to: null, assigned_at: null })
        .eq('id', fixtureId);
    }
  });
});

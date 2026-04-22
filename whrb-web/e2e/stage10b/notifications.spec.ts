import { test, expect } from '@playwright/test';
import {
  ADMIN_STORAGE,
  REP_A_STORAGE,
  loadSnapshot,
  serviceClient,
  snapshotExists,
} from './helpers';

test.describe('stage10b notifications (rep)', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');
  test.use({ storageState: REP_A_STORAGE });

  test('stage10b-t05 self pick-up inserts notification row', async ({ page, baseURL }) => {
    const snap = loadSnapshot();
    const service = serviceClient();
    const fixtureId = snap.fixture_prospect_ids[4];
    await service.from('notifications').delete().eq('recipient_id', snap.rep_a_id);
    await service
      .from('prospects')
      .update({ assigned_to: null, assigned_at: null })
      .eq('id', fixtureId);

    await page.goto(`${baseURL}/prospects/${fixtureId}`);
    await expect(page.getByTestId('assign-picker')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('assign-pickup').click();

    await expect
      .poll(
        async () => {
          const { count } = await service
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_id', snap.rep_a_id)
            .eq('kind', 'assigned');
          return count ?? 0;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    await page.goto(`${baseURL}/`);
    await expect(page.getByTestId('notification-bell')).toBeVisible();
  });
});

test.describe('stage10b settings/notifications', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('admin settings page renders all 6 preference toggles', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/settings/notifications`);
    for (const key of [
      'notify_assignment_toast',
      'notify_assignment_email',
      'notify_mention_toast',
      'notify_mention_email',
      'notify_run_complete_email',
      'notify_feedback_status_email',
    ]) {
      await expect(page.getByTestId(`pref-${key}`)).toBeVisible();
    }
  });
});

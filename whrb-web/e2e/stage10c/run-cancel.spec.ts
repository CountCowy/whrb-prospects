import { test, expect } from '@playwright/test';
import {
  ADMIN_STORAGE,
  REP_STORAGE,
  loadSnapshot,
  serviceClient,
  snapshotExists,
} from './helpers';

test.describe('stage10c run-cancel', () => {
  test.skip(!snapshotExists(), 'Stage 10c snapshot missing');

  test.describe('admin', () => {
    test.use({ storageState: ADMIN_STORAGE });
    // Serial: T15 needs the queued row present; T01 cancels it. Running in
    // parallel workers would race.
    test.describe.configure({ mode: 'serial' });

    test('stage10c-t15 CancelRunButton visibility by status', async ({ page, baseURL }) => {
      const snap = loadSnapshot();
      await page.goto(`${baseURL}/admin/runs`);
      await expect(page.getByTestId('runs-table')).toBeVisible();
      // Queued + running fixtures: button present.
      for (const id of [snap.cancel_targets.queued_id, snap.cancel_targets.running_id]) {
        await expect(
          page.locator(`tr[data-run-id="${id}"] [data-testid="cancel-run-button-${id}"]`),
        ).toBeVisible();
      }
      // Success + failed fixtures: button absent.
      for (const id of [snap.cancel_targets.success_id, snap.cancel_targets.failed_id]) {
        await expect(
          page.locator(`tr[data-run-id="${id}"] [data-testid="cancel-run-button-${id}"]`),
        ).toHaveCount(0);
      }
    });

    test('stage10c-t01 admin cancels queued row via API → status=failed, cancel marker', async ({
      request,
      baseURL,
    }) => {
      const snap = loadSnapshot();
      const service = serviceClient();
      const runId = snap.cancel_targets.queued_id;

      // Sanity: fixture is queued before the call.
      const pre = await service
        .from('pipeline_runs')
        .select('status,error')
        .eq('id', runId)
        .maybeSingle();
      expect(pre.data?.status).toBe('queued');

      const before = Date.now();
      const res = await request.post(`${baseURL}/api/pipeline/run/${runId}/cancel`);
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as { ok: boolean; status: string; mode: string };
      expect(body.status).toBe('failed');
      expect(body.mode).toBe('queued');

      // DB state matches within 500ms.
      await expect
        .poll(async () => {
          const row = await service
            .from('pipeline_runs')
            .select('status,error,finished_at')
            .eq('id', runId)
            .maybeSingle();
          return row.data;
        }, { timeout: 2_000, intervals: [150] })
        .toMatchObject({ status: 'failed' });

      const post = await service
        .from('pipeline_runs')
        .select('status,error,finished_at')
        .eq('id', runId)
        .maybeSingle();
      expect(post.data?.status).toBe('failed');
      expect(post.data?.error).toMatch(/^cancelled by admin:/);
      expect(post.data?.error).toContain('(queued)');
      expect(Date.now() - before).toBeLessThan(10_000);
    });

    test('stage10c-t03 cancel on success row → 400 with no state mutation', async ({
      request,
      baseURL,
    }) => {
      const snap = loadSnapshot();
      const service = serviceClient();
      for (const [kind, id] of [
        ['success', snap.cancel_targets.success_id],
        ['failed', snap.cancel_targets.failed_id],
      ] as const) {
        const res = await request.post(`${baseURL}/api/pipeline/run/${id}/cancel`);
        expect(res.status()).toBe(400);
        const row = await service
          .from('pipeline_runs')
          .select('status,error')
          .eq('id', id)
          .maybeSingle();
        expect(row.data?.status).toBe(kind);
        // Fixture's error is not prefixed with "cancelled by admin"; prove
        // the row was not mutated.
        const err = (row.data?.error ?? '') as string;
        expect(err.startsWith('cancelled by admin')).toBeFalsy();
      }
    });

  });

  test.describe('non-admin rep', () => {
    test.use({ storageState: REP_STORAGE });

    test('stage10c-t04 non-admin POST cancel → 403, no state change', async ({
      request,
      baseURL,
    }) => {
      const snap = loadSnapshot();
      const service = serviceClient();
      // Use the running fixture so the pre-state assertion is observable.
      const id = snap.cancel_targets.running_id;
      const pre = await service
        .from('pipeline_runs')
        .select('status')
        .eq('id', id)
        .maybeSingle();
      expect(pre.data?.status).toBe('running');
      const res = await request.post(`${baseURL}/api/pipeline/run/${id}/cancel`);
      expect([401, 403]).toContain(res.status());
      const post = await service
        .from('pipeline_runs')
        .select('status,error')
        .eq('id', id)
        .maybeSingle();
      expect(post.data?.status).toBe('running');
      const err = (post.data?.error ?? '') as string;
      expect(err.startsWith('cancelled by admin')).toBeFalsy();
    });
  });
});

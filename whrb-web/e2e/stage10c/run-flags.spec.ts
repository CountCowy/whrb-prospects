import { test, expect } from '@playwright/test';
import {
  ADMIN_STORAGE,
  REP_STORAGE,
  serviceClient,
  snapshotExists,
} from './helpers';

test.describe('stage10c run-flags', () => {
  test.skip(!snapshotExists(), 'Stage 10c snapshot missing');

  test.describe('admin', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('stage10c-t05 POST with args="--dry --stage10c-fixture" → 201, args canonicalised on row, dispatch skipped', async ({
      request,
      baseURL,
    }) => {
      const service = serviceClient();
      // The --stage10c-fixture sentinel tells migration 006's
      // dispatch_pipeline_run() to skip this row, so the Edge Function +
      // GitHub Actions workflow never fire for test inserts.
      const res = await request.post(`${baseURL}/api/pipeline/run`, {
        data: { args: '--dry --stage10c-fixture' },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { pipeline_run_id: string; args: string };
      // Canonical order: '--dry' precedes '--stage10c-fixture' per FLAG_WHITELIST.
      expect(body.args).toBe('--dry --stage10c-fixture');
      const row = await service
        .from('pipeline_runs')
        .select('args,triggered_by,status')
        .eq('id', body.pipeline_run_id)
        .maybeSingle();
      expect(row.data?.args).toBe('--dry --stage10c-fixture');
      expect(row.data?.status).toBe('queued');
      // Cleanup — mark as failed so the row drops off the queued view.
      // Dispatch was skipped by migration 006, so no workflow to cancel.
      await service
        .from('pipeline_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: 'stage10c t05 cleanup: disposable fixture',
        })
        .eq('id', body.pipeline_run_id);
    });

    test('stage10c-t06 POST "--with-hic --fresh --stage10c-fixture" → args canonicalised to whitelist order, dispatch skipped', async ({
      request,
      baseURL,
    }) => {
      const service = serviceClient();
      const res = await request.post(`${baseURL}/api/pipeline/run`, {
        data: { args: '--fresh --stage10c-fixture --with-hic' },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { pipeline_run_id: string; args: string };
      // Canonical order from FLAG_WHITELIST: --with-hic, --fresh, --stage10c-fixture.
      expect(body.args).toBe('--with-hic --fresh --stage10c-fixture');
      const row = await service
        .from('pipeline_runs')
        .select('args')
        .eq('id', body.pipeline_run_id)
        .maybeSingle();
      expect(row.data?.args).toBe('--with-hic --fresh --stage10c-fixture');
      await service
        .from('pipeline_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: 'stage10c t06 cleanup: disposable fixture',
        })
        .eq('id', body.pipeline_run_id);
    });

    test('stage10c-t07 unknown flag → 400, no row inserted', async ({ request, baseURL }) => {
      const service = serviceClient();
      const before = new Date().toISOString();
      const res = await request.post(`${baseURL}/api/pipeline/run`, {
        data: { args: '--delete-everything' },
      });
      expect(res.status()).toBe(400);
      // Verify no pipeline_runs row appeared with that arg.
      const since = await service
        .from('pipeline_runs')
        .select('id,args', { count: 'exact' })
        .gte('created_at', before)
        .ilike('args', '%--delete-everything%');
      expect(since.count ?? 0).toBe(0);
    });
  });

  test.describe('non-admin rep', () => {
    test.use({ storageState: REP_STORAGE });

    test('stage10c-t08 non-admin POST /api/pipeline/run → 403', async ({ request, baseURL }) => {
      const res = await request.post(`${baseURL}/api/pipeline/run`, { data: { args: '--dry' } });
      expect([401, 403]).toContain(res.status());
    });
  });
});

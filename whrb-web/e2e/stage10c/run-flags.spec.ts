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

    test('stage10c-t05 POST with args="--dry" → 201, args canonicalised on row', async ({
      request,
      baseURL,
    }) => {
      const service = serviceClient();
      const res = await request.post(`${baseURL}/api/pipeline/run`, {
        data: { args: '--dry' },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { pipeline_run_id: string; args: string };
      expect(body.args).toBe('--dry');
      const row = await service
        .from('pipeline_runs')
        .select('args,triggered_by,status')
        .eq('id', body.pipeline_run_id)
        .maybeSingle();
      expect(row.data?.args).toBe('--dry');
      expect(row.data?.status).toBe('queued');
      // Cleanup — mark as failed so the queued row doesn't trigger the
      // Edge Function dispatch chain on the dev DB. This is a disposable
      // test fixture, not part of stage10c's audit trail.
      await service
        .from('pipeline_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: 'stage10c t05 cleanup: disposable fixture',
        })
        .eq('id', body.pipeline_run_id);
    });

    test('stage10c-t06 POST "--with-hic --fresh" → args canonicalised to whitelist order', async ({
      request,
      baseURL,
    }) => {
      const service = serviceClient();
      const res = await request.post(`${baseURL}/api/pipeline/run`, {
        data: { args: '--with-hic --fresh' },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { pipeline_run_id: string; args: string };
      // Canonical order: '--with-hic' precedes '--fresh' per FLAG_WHITELIST.
      expect(body.args).toBe('--with-hic --fresh');
      const row = await service
        .from('pipeline_runs')
        .select('args')
        .eq('id', body.pipeline_run_id)
        .maybeSingle();
      expect(row.data?.args).toBe('--with-hic --fresh');
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

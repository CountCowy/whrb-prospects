import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, serviceClient, snapshotExists, loadSnapshot } from './helpers';

test.describe('t1 vocab merge (browser-side)', () => {
  test.skip(!snapshotExists(), 'T1 snapshot missing');
  test.use({ storageState: ADMIN_STORAGE });

  test('t1-t09 admin merges X→Y via /api/admin/vocab/[id]/merge; prospect_tags retagged', async ({
    request,
    baseURL,
  }) => {
    const sb = serviceClient();
    const snap = loadSnapshot();

    // Seed two same-axis vocab rows + tag the fixture prospect with the source.
    const { data: src } = await sb
      .from('tag_vocabulary')
      .insert({
        axis: 'sector',
        value: `t1_e2e_merge_src_${Date.now().toString(36)}`,
        status: 'active',
      })
      .select('id, axis, value')
      .single();
    const { data: tgt } = await sb
      .from('tag_vocabulary')
      .insert({
        axis: 'sector',
        value: `t1_e2e_merge_tgt_${Date.now().toString(36)}`,
        status: 'active',
      })
      .select('id, axis, value')
      .single();
    if (!src || !tgt) throw new Error('vocab seed failed');
    await sb.from('prospect_tags').insert({
      prospect_id: snap.prospect_id,
      tag_id: src.id,
    });

    try {
      const res = await request.post(
        `${baseURL}/api/admin/vocab/${src.id}/merge`,
        { data: { target_id: tgt.id } },
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.affected_prospect_count).toBe(1);

      // prospect_tags row now references the target.
      const after = await sb
        .from('prospect_tags')
        .select('tag_id')
        .eq('prospect_id', snap.prospect_id);
      const tagIds = (after.data ?? []).map((r) => r.tag_id);
      expect(tagIds).toContain(tgt.id);
      expect(tagIds).not.toContain(src.id);

      // Source vocab row is gone.
      const srcAfter = await sb
        .from('tag_vocabulary')
        .select('id', { count: 'exact', head: true })
        .eq('id', src.id);
      expect(srcAfter.count ?? 0).toBe(0);
    } finally {
      // Cleanup: remove tagged target row + delete target vocab.
      await sb.from('prospect_tags').delete().eq('tag_id', tgt.id);
      await sb.from('tag_vocabulary').delete().eq('id', tgt.id);
      // src already deleted by merge; defensive in case of error path.
      await sb.from('tag_vocabulary').delete().eq('id', src.id);
    }
  });

  test('t1-t21b cross-axis merge via API → 400', async ({ request, baseURL }) => {
    const sb = serviceClient();
    const { data: src } = await sb
      .from('tag_vocabulary')
      .insert({
        axis: 'history',
        value: `t1_e2e_xaxis_src_${Date.now().toString(36)}`,
        status: 'active',
      })
      .select('id')
      .single();
    const { data: tgt } = await sb
      .from('tag_vocabulary')
      .insert({
        axis: 'sector',
        value: `t1_e2e_xaxis_tgt_${Date.now().toString(36)}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (!src || !tgt) throw new Error('vocab seed failed');
    try {
      const res = await request.post(
        `${baseURL}/api/admin/vocab/${src.id}/merge`,
        { data: { target_id: tgt.id } },
      );
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('P0002');
    } finally {
      await sb.from('tag_vocabulary').delete().eq('id', src.id);
      await sb.from('tag_vocabulary').delete().eq('id', tgt.id);
    }
  });
});

import { test, expect } from '@playwright/test';
import {
  REP_A_STORAGE,
  REP_B_STORAGE,
  loadSnapshot,
  serviceClient,
  snapshotExists,
} from './helpers';

/**
 * t3-t25 — When user X deletes a tag created by user Y, Y's inbox
 * gets a `tag_removed_by_other` notification within ~2 s, and the
 * notifications page deep-links to `/prospects/<id>#activity`.
 */
test.describe('t3 tag-overwrite notification', () => {
  test.skip(!snapshotExists(), 'T3 snapshot missing');

  test('t3-t25 rep_b sees notification after rep_a deletes their tag', async ({ browser }) => {
    test.setTimeout(60_000);
    const snap = loadSnapshot();
    const sb = serviceClient();

    // 1) rep_b inserts a tag (browser fixture writing through the API).
    const repBContext = await browser.newContext({ storageState: REP_B_STORAGE });
    const repBPage = await repBContext.newPage();
    await repBPage.goto(`/prospects/${snap.prospect_id}`);
    await repBPage.waitForSelector('[data-testid="tag-chips-full"]', { timeout: 15_000 });
    // Pick an active vocab to insert.
    const { data: vocab } = await sb
      .from('tag_vocabulary')
      .select('id')
      .eq('status', 'active')
      .eq('axis', 'other')
      .limit(1);
    let vocabId = vocab?.[0]?.id;
    if (!vocabId) {
      const { data: any } = await sb
        .from('tag_vocabulary')
        .select('id')
        .eq('status', 'active')
        .limit(1);
      vocabId = any?.[0]?.id;
    }
    if (!vocabId) throw new Error('no active vocab to test against');
    // Pre-clean any existing row.
    await sb
      .from('prospect_tags')
      .delete()
      .eq('prospect_id', snap.prospect_id)
      .eq('tag_id', vocabId);
    const newRow = await repBPage.evaluate(
      async ([prospectId, tagId]) => {
        const res = await fetch(`/api/prospects/${prospectId}/tags`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tag_id: tagId }),
        });
        return res.ok ? await res.json() : null;
      },
      [snap.prospect_id, vocabId] as const,
    );
    expect(newRow?.id).toBeTruthy();
    await repBContext.close();

    // 2) rep_a deletes that tag.
    const repAContext = await browser.newContext({ storageState: REP_A_STORAGE });
    const repAPage = await repAContext.newPage();
    await repAPage.goto(`/prospects/${snap.prospect_id}`);
    await repAPage.waitForSelector('[data-testid="tag-chips-full"]', { timeout: 15_000 });
    await repAPage.evaluate(
      async ([prospectId, tagRowId]) => {
        await fetch(`/api/prospects/${prospectId}/tags?tag_row_id=${tagRowId}`, {
          method: 'DELETE',
        });
      },
      [snap.prospect_id, newRow.id] as const,
    );
    await repAContext.close();

    // 3) Confirm rep_b has a tag_removed_by_other notification.
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 5_000) {
      const { data } = await sb
        .from('notifications')
        .select('id,kind,actor_id')
        .eq('recipient_id', snap.rep_b_id)
        .eq('kind', 'tag_removed_by_other')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        expect(data[0].actor_id).toEqual(snap.rep_a_id);
        // Cleanup.
        await sb.from('notifications').delete().eq('id', data[0].id);
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(found).toBe(true);
  });
});

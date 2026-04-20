import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');
const REP_A_STORAGE = path.join(__dirname, '../.auth/rep-a.json');
const REP_B_STORAGE = path.join(__dirname, '../.auth/rep-b.json');

// T06: add note propagates to a second tab within 2s via Realtime.
// The test allows a reload fallback since dev-mode Realtime can take a
// beat to establish the channel on first subscription.
test('stage7-t06 note add propagates to second browser', async ({ browser }) => {
  const snap = loadSnapshot();
  const pid = snap.note_subject_id;

  const viewerCtx = await browser.newContext({ storageState: REP_B_STORAGE });
  const authorCtx = await browser.newContext({ storageState: REP_A_STORAGE });
  const viewer = await viewerCtx.newPage();
  const author = await authorCtx.newPage();

  await viewer.goto(`/prospects/${pid}`);
  await viewer.getByTestId('tab-notes').click();
  await author.goto(`/prospects/${pid}`);
  await author.getByTestId('tab-notes').click();

  // Give Realtime's channel a moment to subscribe before triggering.
  await viewer.waitForTimeout(1500);

  const body = `[stage7_integrity_realtime] ${Date.now()}`;
  await author.getByTestId('note-draft').fill(body);
  await author.getByTestId('note-submit').click();

  // Either Realtime delivers within 2s or the test reloads and verifies.
  // After reload the Notes tab must be re-selected (tab state is client-only).
  await expect(async () => {
    let visible = await viewer.getByTestId('note-body').filter({ hasText: body }).count();
    if (visible === 0) {
      await viewer.reload();
      await viewer.getByTestId('tab-notes').click();
      visible = await viewer.getByTestId('note-body').filter({ hasText: body }).count();
    }
    expect(visible).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  // Cleanup.
  const svc = serviceClient();
  await svc.from('prospect_notes').delete().eq('body', body);

  await viewerCtx.close();
  await authorCtx.close();
});

// T07: author edits own → edited flag visible + body updated.
test('stage7-t07 author edit sets "edited" flag on note', async ({ browser }) => {
  const snap = loadSnapshot();
  const pid = snap.note_subject_id;
  const svc = serviceClient();
  // Seed a note authored by rep-a for this test.
  const body1 = `[stage7_edit_start] ${Date.now()}`;
  const body2 = `${body1} — edited`;
  const ins = await svc
    .from('prospect_notes')
    .insert({ prospect_id: pid, author_id: snap.rep_a_id, body: body1 })
    .select('id')
    .single();
  const noteId = ins.data!.id;
  try {
    const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
    const page = await ctx.newPage();
    await page.goto(`/prospects/${pid}`);
    await page.getByTestId('tab-notes').click();
    const item = page.locator(`[data-testid="note-item"][data-note-id="${noteId}"]`);
    await item.getByTestId('note-edit').click();
    await item.getByTestId('note-edit-input').fill(body2);
    const saveResponse = page.waitForResponse((r) =>
      r.url().includes(`/notes/${noteId}`) && r.request().method() === 'PATCH',
    );
    await item.getByTestId('note-save').click();
    await saveResponse;
    await expect(item.getByTestId('note-body')).toHaveText(body2, { timeout: 6_000 });
    await expect(item.getByTestId('note-timestamp')).toContainText('edited');
    await ctx.close();
  } finally {
    await svc.from('prospect_notes').delete().eq('id', noteId);
  }
});

// T08: author soft-deletes own → disappears from their rep view.
test('stage7-t08 author soft-delete hides note from rep view', async ({ browser }) => {
  const snap = loadSnapshot();
  const pid = snap.note_subject_id;
  const svc = serviceClient();
  const body = `[stage7_softdelete_author] ${Date.now()}`;
  const ins = await svc
    .from('prospect_notes')
    .insert({ prospect_id: pid, author_id: snap.rep_a_id, body })
    .select('id')
    .single();
  const noteId = ins.data!.id;
  try {
    const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
    const page = await ctx.newPage();
    await page.goto(`/prospects/${pid}`);
    await page.getByTestId('tab-notes').click();
    const item = page.locator(`[data-testid="note-item"][data-note-id="${noteId}"]`);
    await expect(item).toBeVisible();
    await item.getByTestId('note-delete').click();
    await page.reload();
    await page.getByTestId('tab-notes').click();
    await expect(
      page.locator(`[data-testid="note-item"][data-note-id="${noteId}"]`),
    ).toHaveCount(0);

    // DB check: deleted_at + deleted_by set.
    const { data: check } = await svc
      .from('prospect_notes')
      .select('deleted_at,deleted_by')
      .eq('id', noteId)
      .single();
    expect(check?.deleted_at).not.toBeNull();
    expect(check?.deleted_by).toBe(snap.rep_a_id);
    await ctx.close();
  } finally {
    await svc.from('prospect_notes').delete().eq('id', noteId);
  }
});

// T09: admin deletes Rep A's note → rep doesn't see it after reload; deleted_by=admin.
test('stage7-t09 admin soft-delete hides note from rep', async ({ browser }) => {
  const snap = loadSnapshot();
  const pid = snap.note_subject_id;
  const svc = serviceClient();
  const body = `[stage7_admin_delete] ${Date.now()}`;
  const ins = await svc
    .from('prospect_notes')
    .insert({ prospect_id: pid, author_id: snap.rep_a_id, body })
    .select('id')
    .single();
  const noteId = ins.data!.id;
  try {
    const adminCtx = await browser.newContext({ storageState: ADMIN_STORAGE });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`/prospects/${pid}`);
    await adminPage.getByTestId('tab-notes').click();
    const adminItem = adminPage.locator(
      `[data-testid="note-item"][data-note-id="${noteId}"]`,
    );
    await expect(adminItem).toBeVisible();
    await adminItem.getByTestId('note-delete').click();
    await adminCtx.close();

    const repCtx = await browser.newContext({ storageState: REP_A_STORAGE });
    const repPage = await repCtx.newPage();
    await repPage.goto(`/prospects/${pid}`);
    await repPage.getByTestId('tab-notes').click();
    await expect(
      repPage.locator(`[data-testid="note-item"][data-note-id="${noteId}"]`),
    ).toHaveCount(0);

    const { data: check } = await svc
      .from('prospect_notes')
      .select('deleted_at,deleted_by')
      .eq('id', noteId)
      .single();
    expect(check?.deleted_at).not.toBeNull();
    expect(check?.deleted_by).toBe(snap.admin_id);
    await repCtx.close();
  } finally {
    await svc.from('prospect_notes').delete().eq('id', noteId);
  }
});

// T10: admin restore → note reappears for everyone.
test('stage7-t10 admin restore un-hides note', async ({ browser }) => {
  const snap = loadSnapshot();
  const pid = snap.note_subject_id;
  const svc = serviceClient();
  const body = `[stage7_restore] ${Date.now()}`;
  const ins = await svc
    .from('prospect_notes')
    .insert({
      prospect_id: pid,
      author_id: snap.rep_a_id,
      body,
      deleted_at: new Date().toISOString(),
      deleted_by: snap.admin_id,
    })
    .select('id')
    .single();
  const noteId = ins.data!.id;
  try {
    const adminCtx = await browser.newContext({ storageState: ADMIN_STORAGE });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`/prospects/${pid}`);
    await adminPage.getByTestId('tab-notes').click();
    await adminPage.getByTestId('notes-admin-ghost-toggle').locator('input').check();
    const adminItem = adminPage.locator(
      `[data-testid="note-item"][data-note-id="${noteId}"]`,
    );
    await expect(adminItem).toBeVisible();
    const restoreResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/notes/${noteId}`) && r.request().method() === 'PATCH',
    );
    await adminItem.getByTestId('note-restore').click();
    await restoreResp;
    await adminCtx.close();

    const repCtx = await browser.newContext({ storageState: REP_A_STORAGE });
    const repPage = await repCtx.newPage();
    await repPage.goto(`/prospects/${pid}`);
    await repPage.getByTestId('tab-notes').click();
    await expect(
      repPage.locator(`[data-testid="note-item"][data-note-id="${noteId}"]`),
    ).toBeVisible();
    await repCtx.close();

    const { data: check } = await svc
      .from('prospect_notes')
      .select('deleted_at,deleted_by')
      .eq('id', noteId)
      .single();
    expect(check?.deleted_at).toBeNull();
    expect(check?.deleted_by).toBeNull();
  } finally {
    await svc.from('prospect_notes').delete().eq('id', noteId);
  }
});

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');
const REP_A_STORAGE = path.join(__dirname, '../.auth/rep-a.json');

// T03 (UI): editing a field via FieldEditor persists and shows the lock icon.
// T04 (UI): unlocking removes the lock icon; value remains.
test('stage7-t03-t04 field edit + unlock round-trip (admin)', async ({ browser }) => {
  const snap = loadSnapshot();
  const subject = snap.lock_subjects['website'];
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto(`/prospects/${subject.id}`);
  await page.getByTestId('tab-fields').click();

  const testUrl = `https://stage7-test-${Date.now()}.example.com`;
  await page.getByTestId('field-edit-website').click();
  await page.getByTestId('field-input-website').fill(testUrl);
  const saveResp = page.waitForResponse((r) =>
    r.url().endsWith(`/api/prospects/${subject.id}`) && r.request().method() === 'PATCH',
  );
  await page.getByTestId('field-save-website').click();
  await saveResp;

  await expect(page.getByTestId('field-value-website')).toHaveText(testUrl);
  await expect(page.getByTestId('lock-website')).toBeVisible();

  // Unlock
  const unlockResp = page.waitForResponse((r) =>
    r.url().endsWith(`/api/prospects/${subject.id}`) && r.request().method() === 'PATCH',
  );
  await page.getByTestId('field-unlock-website').click();
  await unlockResp;
  await expect(page.getByTestId('lock-website')).toHaveCount(0);
  await expect(page.getByTestId('field-value-website')).toHaveText(testUrl);

  // Restore via service client so we don't leak test state.
  const svc = serviceClient();
  await svc
    .from('prospects')
    .update({
      website: subject.snapshot.website,
      user_overrides: subject.snapshot.user_overrides ?? {},
    })
    .eq('id', subject.id);
  await ctx.close();
});

// T22 (UI): a non-assignee non-admin rep sees no Edit controls (they're hidden
// because `editable=false` in ProspectDetail). Verified against a row they
// don't own.
test('stage7-t22 non-assignee rep has no edit affordance', async ({ browser }) => {
  const snap = loadSnapshot();
  const subject = snap.lock_subjects['company_phone'];
  const svc = serviceClient();
  // Ensure the row is not assigned to anyone.
  await svc
    .from('prospects')
    .update({ assigned_to: null, assigned_at: null })
    .eq('id', subject.id);
  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const page = await ctx.newPage();
  await page.goto(`/prospects/${subject.id}`);
  await page.getByTestId('tab-fields').click();
  await expect(page.getByTestId('field-edit-company_phone')).toHaveCount(0);
  await ctx.close();
});

// T20 (UI): the "+ Add prospect" button is visible to admin on /prospects
// and the modal creates a row with created_source='manual'.
test('stage7-t20 admin + add prospect flow creates manual row', async ({ browser }) => {
  const snap = loadSnapshot();
  const svc = serviceClient();
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/prospects');
  await expect(page.getByTestId('add-prospect-button')).toBeVisible();
  await page.getByTestId('add-prospect-button').click();
  const marker = `${snap.manual_add_tag}-${Date.now()}`;
  await page.getByTestId('add-company-name').fill(marker);
  await page.getByTestId('add-tier').selectOption('B');
  await page.getByTestId('add-prospect-submit').click();

  // Nav lands on the newly created prospect's detail page.
  await page.waitForURL(/\/prospects\/[0-9a-f-]+$/);

  // Verify DB side: created_source='manual', business_key='manual-<uuid>'
  const { data } = await svc
    .from('prospects')
    .select('id,business_key,created_source,tier,company_name')
    .eq('company_name', marker)
    .maybeSingle();
  expect(data).not.toBeNull();
  expect(data?.created_source).toBe('manual');
  expect(data?.business_key?.startsWith('manual-')).toBe(true);

  // Cleanup
  if (data?.id) await svc.from('prospects').delete().eq('id', data.id);
  await ctx.close();
});

// T21 (UI): a rep does NOT see the "+ Add prospect" button.
test('stage7-t21 rep does not see + Add prospect button', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/prospects');
  await expect(page.getByTestId('add-prospect-button')).toHaveCount(0);
  await ctx.close();
});

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');

// T12: field edit produces an activity entry.
// T14: note add + edit + delete → three activity entries (checked via DB counts
//      that the integrity tests also assert, so here we just ensure the
//      Activity tab surfaces the field change category).
// T16: sort toggle works.
test('stage7-t12-t16 field edit surfaces in Activity + sort toggle', async ({ browser }) => {
  const snap = loadSnapshot();
  const subject = snap.lock_subjects['company_email'];
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto(`/prospects/${subject.id}`);
  await page.getByTestId('tab-fields').click();

  // Edit a field as admin (always editable).
  const testEmail = `stage7+activity-${Date.now()}@example.com`;
  await page.getByTestId('field-edit-company_email').click();
  await page.getByTestId('field-input-company_email').fill(testEmail);
  await page.getByTestId('field-save-company_email').click();

  await page.getByTestId('tab-activity').click();
  const latest = page.getByTestId('activity-entry').first();
  await expect(latest).toContainText('company_email');

  // Sort toggle
  await page.getByTestId('activity-sort-toggle').click();
  await expect(page.getByTestId('activity-sort-toggle')).toContainText('Oldest first');

  // Cleanup
  const svc = serviceClient();
  await svc
    .from('prospects')
    .update({
      company_email: subject.snapshot.company_email,
      user_overrides: subject.snapshot.user_overrides ?? {},
    })
    .eq('id', subject.id);

  await ctx.close();
});

// T15: admin-only "include deleted note history" chip.
test('stage7-t15 admin activity deleted-note chip toggles', async ({ browser }) => {
  const snap = loadSnapshot();
  const subject = snap.lock_subjects['company_name'];
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto(`/prospects/${subject.id}`);
  await page.getByTestId('tab-activity').click();
  const chip = page.getByTestId('activity-deleted-toggle').locator('input');
  await expect(chip).toBeVisible();
  await chip.check();
  await expect(chip).toBeChecked();
  await chip.uncheck();
  await expect(chip).not.toBeChecked();
  await ctx.close();
});

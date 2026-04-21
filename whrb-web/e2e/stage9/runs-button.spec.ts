import { test, expect } from '@playwright/test';
import path from 'node:path';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');

// Trigger-run button is rendered but disabled (wired in Stage 10).
test('stage9-runs trigger button is visibly disabled', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/admin/runs');
  const btn = page.getByTestId('trigger-run-button');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText(/Stage 10/);
});

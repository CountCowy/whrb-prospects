import { test, expect } from '@playwright/test';

/**
 * Stage 6a smoke test.
 *
 * Proves the Playwright harness:
 *   1. can authenticate a synthetic user via `auth.setup.ts`
 *   2. loads that session from `storageState`
 *   3. renders an authed page (`/`) without bouncing to `/login`
 *
 * Stage 6 replaces this with real page-level checks; this test stays as a
 * permanent harness canary.
 */
test('authenticated user lands on Home and sees the greeting', async ({ page }) => {
  await page.goto('/');

  // Did not get bounced to /login by middleware.
  await expect(page).toHaveURL(/\/$/);

  // Greeting is the Stage 5 hero, "Welcome, <first-name>."
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toBeVisible();
  await expect(h1).toContainText('Welcome,');

  // Crimson pill identifies the WHRB shell even if the greeting copy shifts.
  await expect(page.getByText(/WHRB 95.3 FM · Sales/i, { exact: false }).first()).toBeVisible();
});

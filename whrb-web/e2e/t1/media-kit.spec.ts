import { test, expect, request as plRequest } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.describe('t1 media kit', () => {
  test.skip(!snapshotExists(), 'T1 snapshot missing');

  test.describe('authed', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('t1-t26 /media-kit stub renders with hero + Download PDF button', async ({
      page,
    }) => {
      await page.goto('/media-kit');
      await expect(page.locator('[data-testid="media-kit-page"]')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'WHRB 95.3 FM — 2026 Media Kit' }),
      ).toBeVisible();
      const dl = page.locator('[data-testid="media-kit-download"]');
      await expect(dl).toBeVisible();
      const href = await dl.getAttribute('href');
      expect(href).toContain('media-kit-2026.pdf');
      await expect(page.getByText('Content coming in T4')).toBeVisible();
    });

    test('t1-t26b nav contains Media Kit between Prospects and Guide', async ({ page }) => {
      await page.goto('/');
      // Desktop nav uses an inline link list.
      const links = page.locator('nav[aria-label="Primary"] a');
      const labels = await links.allTextContents();
      // Filter to known top-level labels and verify ordering.
      const known = ['All Prospects', 'Media Kit', 'Guide'];
      const filtered = labels.filter((l) => known.includes(l.trim()));
      expect(filtered).toEqual(known);
    });
  });

  test.describe('anon', () => {
    // Drop storageState so the request is unauthenticated.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('t1-t27a anon GET /media-kit → redirected to /login', async ({ page }) => {
      const resp = await page.goto('/media-kit');
      // The (app) layout redirects to /login when no session.
      await expect(page).toHaveURL(/\/login/);
      // Response may be the eventual /login page or a redirect chain — both OK.
      expect(resp).toBeTruthy();
    });

    test('t1-t27b anon GET /media-kit-2026.pdf → 200 + application/pdf', async ({
      baseURL,
    }) => {
      if (!baseURL) throw new Error('baseURL required');
      const ctx = await plRequest.newContext({ baseURL });
      try {
        const resp = await ctx.get('/media-kit-2026.pdf');
        expect(resp.status()).toBe(200);
        const ctype = resp.headers()['content-type'] ?? '';
        expect(ctype).toContain('application/pdf');
        const body = await resp.body();
        expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      } finally {
        await ctx.dispose();
      }
    });
  });
});

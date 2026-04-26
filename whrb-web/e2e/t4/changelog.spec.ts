import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_STORAGE, REP_STORAGE, loadSnapshot } from './helpers';

function requireEnv(name: string, ...aliases: string[]): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var: ${[name, ...aliases].join(' / ')}`);
}

test.describe('T4 · /changelog (Tks T21, T22)', () => {
  test.describe('rep view', () => {
    test.use({ storageState: REP_STORAGE });

    test('T21 · first-login toast fires for rep with planted entry', async ({
      page,
    }) => {
      // Prior test runs may have already POSTed /api/changelog/ack, so
      // reset the rep's last_changelog_ack to 1 day ago via service role
      // *before* the page load. Also bump the planted entry's
      // released_at to "now" so it's strictly newer than the ack.
      const snap = loadSnapshot();
      const sb = createClient(
        requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
        requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const justNow = new Date().toISOString();
      await sb
        .from('profiles')
        .update({ last_changelog_ack: oneHourAgo })
        .eq('id', snap.rep_id);
      await sb
        .from('changelog_entries')
        .update({ released_at: justNow })
        .eq('id', snap.changelog_id);
      // Pre-flight sanity: hit `/api/changelog/ack`-free page. /login is
      // public and bypasses the (app) layout, so it can't trip the
      // auto-close ack via toast unmount. Skip it — go straight to /.
      await page.goto('/', { waitUntil: 'networkidle' });
      // Verify SSR resolved a pending entry. If marker says pending=false
      // the test fails fast with a clear message.
      const marker = page.getByTestId('changelog-toast-marker');
      await expect(marker).toHaveAttribute('data-pending', 'true', {
        timeout: 5_000,
      });
      // Look for the sonner toast container first; the inner test-id
      // is on the JSX content but Sonner may render it inside a wrapper.
      const sonnerToast = page.locator('[data-sonner-toast]').first();
      await expect(sonnerToast).toBeVisible({ timeout: 15_000 });
      const toast = sonnerToast.getByTestId('changelog-toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText("What's new");
      // Click "See changelog" link.
      const link = page.getByTestId('changelog-toast-link');
      await link.click();
      await page.waitForURL(/\/changelog$/);
      await expect(page.getByTestId('changelog-page')).toBeVisible();
    });
  });

  test.describe('admin view', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('T22.audience · admin sees rep + admin + all entries', async ({ page }) => {
      const snap = loadSnapshot();
      await page.goto('/changelog');
      await expect(page.getByTestId('changelog-page')).toBeVisible();
      const entry = page.locator(
        `[data-testid="changelog-entry"][data-slug="${snap.changelog_slug}"]`,
      );
      await expect(entry).toBeVisible();
    });

    test('admin can publish a new entry', async ({ page }) => {
      await page.goto('/admin/changelog');
      await expect(page.getByTestId('changelog-admin-editor')).toBeVisible();
      const slug = `t4-test-${Date.now()}`;
      await page.getByTestId('changelog-slug').fill(slug);
      await page.getByTestId('changelog-title').fill('T4 Playwright smoke entry');
      await page
        .getByTestId('changelog-body-input')
        .fill('Three sentence smoke. Body. End.');
      await page.getByTestId('changelog-publish').click();
      // Toast appears + the new entry shows on the list. router.refresh()
      // re-renders the server component on a navigation event; force a
      // reload here so the test isn't gated on RSC streaming timing.
      await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
        timeout: 5_000,
      });
      await page.reload();
      await expect(
        page.locator(
          `[data-testid="admin-changelog-entry"][data-slug="${slug}"]`,
        ),
      ).toBeVisible({ timeout: 10_000 });
      // Cleanup — leave behind; the t4_cleanup script doesn't track this
      // smoke entry. A deferred follow-up could `delete from
      // changelog_entries where slug like 't4-test-%'` after the run.
    });
  });
});

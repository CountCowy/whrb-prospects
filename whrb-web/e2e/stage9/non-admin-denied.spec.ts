import { test, expect } from '@playwright/test';
import path from 'node:path';

const REP_STORAGE = path.join(__dirname, '../.auth/stage9-rep.json');

// T02 (UI): non-admin SSR access to admin pages renders the 403 fallback.
test('stage9-t02 non-admin sees 403 on every admin page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: REP_STORAGE });
  const page = await ctx.newPage();
  for (const p of [
    '/admin/sources',
    '/admin/runs',
    '/admin/users',
    '/admin/logs',
    '/admin/feedback',
  ]) {
    await page.goto(p);
    await expect(page.getByRole('heading', { name: '403 — Forbidden' })).toBeVisible();
  }
});

// T03 (UI): non-admin fetch to admin APIs → 403.
test('stage9-t03 non-admin PATCH on admin APIs returns 403', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: REP_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/');

  const calls = [
    {
      method: 'PATCH',
      url: '/api/sources/city_licenses',
      body: { enabled: true },
    },
    {
      method: 'POST',
      url: '/api/admin/users/invite',
      body: { email: 'stage9-deny@example.com' },
    },
    {
      method: 'PATCH',
      url: '/api/admin/feedback/00000000-0000-0000-0000-000000000000',
      body: { status: 'acknowledged' },
    },
  ];
  for (const call of calls) {
    const resp = await page.evaluate(async (c) => {
      const r = await fetch(c.url, {
        method: c.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      });
      return r.status;
    }, call);
    expect(resp, `${call.method} ${call.url}`).toBe(403);
  }
});

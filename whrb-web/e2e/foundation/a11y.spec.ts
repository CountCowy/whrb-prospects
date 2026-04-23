/**
 * Foundation a11y gate.
 *
 * Runs `@axe-core/playwright` against every primary authed route landed
 * by T1 + the foundation PR. Fails the suite on any `serious` or
 * `critical` WCAG violation (impact levels set by axe-core itself).
 * `minor` and `moderate` surface as console annotations for triage
 * without failing.
 *
 * Replaces the foundation plan's earlier manual-devtools-axe pass —
 * durable PR gate that runs on every preview deploy.
 *
 * Extension convention (sister to the Command Palette §1.5 route-add
 * rule): stages that introduce a new authed route append it to
 * ROUTES below in the same PR.
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

type Route = {
  /** Path to visit. Can be a literal string or a function that resolves at runtime. */
  path: string | (() => Promise<string>);
  /** Display name in the test report. */
  label: string;
  /**
   * If the route requires admin auth and the current storage state is a rep,
   * the page 403s / redirects. Set this flag to skip the route gracefully
   * instead of failing. Default: false (route is visible to any authed user).
   */
  adminOnly?: boolean;
};

const ROUTES: Route[] = [
  { path: '/', label: 'Home' },
  { path: '/prospects', label: 'All Prospects' },
  { path: '/media-kit', label: 'Media Kit' },
  { path: '/guide', label: 'Guide' },
  // Admin — default e2e user is a rep, so these will typically redirect/403
  // in this spec's storage state. They run on PRs that plant admin fixtures
  // (Stage 10b path) and skip otherwise. Wire admin fixtures into this spec
  // when an admin-only stage lands that wants tighter a11y coverage.
  { path: '/admin/vocab', label: 'Admin · Vocabulary', adminOnly: true },
  { path: '/admin/sources', label: 'Admin · Sources', adminOnly: true },
];

test.describe('Foundation — a11y (@axe-core/playwright)', () => {
  for (const route of ROUTES) {
    test(`no serious/critical a11y violations: ${route.label}`, async ({ page }) => {
      const path = typeof route.path === 'string' ? route.path : await route.path();
      const response = await page.goto(path, { waitUntil: 'networkidle' });

      if (route.adminOnly && response) {
        const finalUrl = page.url();
        if (/\/login(\?|$)/.test(finalUrl) || response.status() === 403) {
          test.skip(
            true,
            `admin route — default e2e storage is rep; run under admin-auth project to cover`,
          );
        }
      }

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      const nonBlocking = results.violations.filter(
        (v) => v.impact === 'minor' || v.impact === 'moderate',
      );

      // Surface non-blocking so reviewers see what needs cleanup
      // later without a failing PR.
      if (nonBlocking.length > 0) {
        console.log(
          `[a11y ${route.label}] ${nonBlocking.length} minor/moderate:`,
          nonBlocking.map((v) => `${v.id} (${v.impact})`).join(', '),
        );
      }

      expect(
        blocking,
        `${route.label}: serious/critical a11y violations:\n${blocking
          .map((v) => `  - ${v.id} (${v.impact}): ${v.description}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }

  // /prospects/[id] is its own test because we need to resolve a real row
  // at runtime (first row on the /prospects list page).
  test('no serious/critical a11y violations: Prospect detail (first row)', async ({ page }) => {
    await page.goto('/prospects', { waitUntil: 'networkidle' });
    const firstRow = page.getByTestId('prospect-row').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No prospect rows present — seed fixtures before running this case');
    }
    const href = await firstRow
      .locator('a[href^="/prospects/"]')
      .first()
      .getAttribute('href');
    if (!href) {
      test.skip(true, 'First row has no detail link');
    }
    await page.goto(href!, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('prospect-detail')).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const nonBlocking = results.violations.filter(
      (v) => v.impact === 'minor' || v.impact === 'moderate',
    );

    if (nonBlocking.length > 0) {
      console.log(
        `[a11y Prospect detail] ${nonBlocking.length} minor/moderate:`,
        nonBlocking.map((v) => `${v.id} (${v.impact})`).join(', '),
      );
    }

    expect(
      blocking,
      `Prospect detail: serious/critical a11y violations:\n${blocking
        .map((v) => `  - ${v.id} (${v.impact}): ${v.description}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

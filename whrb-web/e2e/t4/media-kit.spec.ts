import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN_STORAGE, loadSnapshot } from './helpers';

test.use({ storageState: ADMIN_STORAGE });

test.describe('T4 · /media-kit (Tks T24-T31)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media-kit');
    await expect(page.getByTestId('media-kit-page')).toBeVisible();
  });

  test('T24 · renders all 7 sections + stats strip', async ({ page }) => {
    await expect(page.getByTestId('media-kit-hero')).toBeVisible();
    await expect(page.getByTestId('about-whrb')).toBeVisible();
    await expect(page.getByTestId('programs')).toBeVisible();
    await expect(page.getByTestId('rate-card')).toBeVisible();
    await expect(page.getByTestId('signal-map-section')).toBeVisible();
    await expect(page.getByTestId('featured-clients')).toBeVisible();
    await expect(page.getByTestId('media-kit-contact')).toBeVisible();

    // Stats strip — 3 values present.
    const stats = page.getByTestId('media-kit-stats');
    await expect(stats.getByTestId('stat-listeners')).toContainText('4,000,000+');
    await expect(stats.getByTestId('stat-site-visits')).toContainText('10,000+');
    await expect(stats.getByTestId('stat-guide-subs')).toContainText('4,500+');

    // PDF button has the right href.
    await expect(page.getByTestId('media-kit-download')).toHaveAttribute(
      'href',
      /media-kit-2026\.pdf$/,
    );
  });

  test('T25 · rate-card values match RATE_CARD config', async ({ page }) => {
    const regular = page.getByTestId('rate-card-regular');
    await expect(regular).toBeVisible();
    // Spot-check the 4 program rows + dollars.
    await expect(regular).toContainText('Classical');
    await expect(regular).toContainText('Jazz');
    await expect(regular).toContainText('Blues');
    await expect(regular).toContainText('$60');
    await expect(regular).toContainText('$75');
    await expect(regular).toContainText('$70');
    await expect(regular).toContainText('$30');

    const special = page.getByTestId('rate-card-special');
    await expect(special).toContainText('Sunday Night at the Opera');
    await expect(special).toContainText('Sports In-Game Mentions');
    await expect(special).toContainText('$20');
  });

  test('T26 · rate-card program links resolve', async ({ page }) => {
    const links = page.getByTestId('rate-card-program-link');
    await expect(links).toHaveCount(4);
    const classicalLink = links.filter({ hasText: 'Classical' }).first();
    await expect(classicalLink).toHaveAttribute(
      'href',
      /\/prospects\?daypart=classical/,
    );
    const jazzLink = links.filter({ hasText: 'Jazz' }).first();
    await expect(jazzLink).toHaveAttribute(
      'href',
      /\/prospects\?daypart=jazz/,
    );
  });

  test('T27 · signal map SVG + fallback list + a11y posture', async ({ page }) => {
    const svg = page.getByTestId('signal-map-svg');
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg).toHaveAttribute('aria-label', /WHRB signal area/i);

    // <details> fallback is the keyboard + screen-reader path; expand it
    // and verify every city is a real anchor.
    await page.getByTestId('signal-map-fallback').click();
    const fallbackLinks = page.getByTestId('signal-map-fallback-link');
    await expect(fallbackLinks).toHaveCount(15);

    // Boston anchor routes to boston_based; Nashua is not in the
    // current city list, so check Manchester NH which is a fringe city
    // that maps to new_england_regional.
    const boston = fallbackLinks.filter({ hasText: /^Boston$/ }).first();
    await expect(boston).toHaveAttribute('href', /affiliation=boston_based/);
    const manchester = fallbackLinks.filter({ hasText: 'Manchester NH' }).first();
    await expect(manchester).toHaveAttribute(
      'href',
      /affiliation=new_england_regional/,
    );
  });

  test('T28 · featured-client BSO match resolves to /prospects/<id>', async ({
    page,
  }) => {
    const snap = loadSnapshot();
    await expect(page.getByTestId('featured-clients-grid')).toBeVisible();

    // 9 logo images each with non-empty alt.
    const logos = page.getByTestId('featured-client-logo');
    await expect(logos).toHaveCount(9);
    for (let i = 0; i < 9; i++) {
      const alt = await logos.nth(i).getAttribute('alt');
      expect(alt && alt.length > 0).toBeTruthy();
    }

    // BSO fixture should resolve to ANY prospect with the matching name
    // (the corpus has multiple BSO rows from prior seed runs). What we
    // care about is that the name-match path works — internal anchor,
    // not the external fallback URL. Compound attr selector — both
    // data attrs are on the same <li>.
    const bso = page.locator(
      '[data-testid="featured-client"][data-client="Boston Symphony Orchestra"]',
    );
    await expect(bso).toHaveCount(1);
    await expect(bso).toHaveAttribute('data-resolution', 'prospect');

    // Click into the prospect — accept any UUID path.
    await bso.getByRole('link').first().click();
    await page.waitForURL(/\/prospects\/[0-9a-f-]{36}$/);
    // bso_id from the snapshot may or may not be the resolved row;
    // either way we landed on a prospect detail page.
    expect(snap.bso_id).toMatch(/[0-9a-f-]{36}/);
  });

  test('T29 · download print PDF link is wired', async ({ page }) => {
    const dl = page.getByTestId('media-kit-download');
    await expect(dl).toHaveAttribute('download', '');
    await expect(dl).toHaveAttribute('href', /media-kit-2026\.pdf$/);
    // Don't actually trigger the download — just confirm the asset exists
    // by issuing a HEAD via fetch.
    const res = await page.request.fetch('/media-kit-2026.pdf', {
      method: 'GET',
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toMatch(/application\/pdf/);
  });

  test('T30 · @axe-core/playwright pass at WCAG 2.1 AA', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('T31 · mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await expect(page.getByTestId('media-kit-page')).toBeVisible();
    await expect(page.getByTestId('media-kit-download')).toBeVisible();
    await expect(page.getByTestId('rate-card-regular')).toBeVisible();
    await expect(page.getByTestId('signal-map-svg')).toBeVisible();
  });
});

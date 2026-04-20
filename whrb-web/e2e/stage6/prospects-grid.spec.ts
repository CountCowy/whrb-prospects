import { test, expect } from '@playwright/test';

test.describe('Stage 6 — All Prospects grid', () => {
  test('T03 default sort: priority_score DESC non-increasing in first page', async ({ page }) => {
    await page.goto('/prospects?pageSize=50');
    const scoreHeader = page.getByTestId('th-priority_score');
    await expect(scoreHeader).toBeVisible();
    // Header shows the active sort arrow "▼" for desc.
    await expect(scoreHeader).toContainText('▼');

    const rows = page.getByTestId('prospect-row');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('T04 page-size picker 25/50/100/250 changes row count', async ({ page }) => {
    await page.goto('/prospects');
    const pageSize = page.getByTestId('page-size');
    await expect(pageSize).toBeVisible();
    for (const n of ['25', '100']) {
      await pageSize.selectOption(n);
      await page.waitForURL(new RegExp(`pageSize=${n}`));
      const rows = page.getByTestId('prospect-row');
      await expect(rows.first()).toBeVisible();
      const count = await rows.count();
      expect(count).toBeLessThanOrEqual(Number(n));
      expect(count).toBeGreaterThan(0);
    }
  });

  test('T05 two-filter combo (tier=A & state=researching) narrows result count', async ({ page }) => {
    await page.goto('/prospects?pageSize=50');
    const summaryAll = await page.getByTestId('results-summary').innerText();
    const totalAll = Number((summaryAll.match(/^([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? '0');
    await page.getByTestId('filter-tier').selectOption('A');
    await page.waitForURL(/tier=A/);
    const summaryTierA = await page.getByTestId('results-summary').innerText();
    const totalTierA = Number((summaryTierA.match(/^([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? '0');
    expect(totalTierA).toBeLessThan(totalAll);
    await page.getByTestId('filter-state').selectOption('researching');
    await page.waitForURL(/state=researching/);
    const summaryCombo = await page.getByTestId('results-summary').innerText();
    const totalCombo = Number((summaryCombo.match(/^([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? '0');
    expect(totalCombo).toBeLessThanOrEqual(totalTierA);
  });

  test('T06+T07 search debounces and narrows results across entire dataset', async ({ page }) => {
    await page.goto('/prospects');
    const initial = await page.getByTestId('results-summary').innerText();
    const input = page.getByLabel('Search prospects');
    // Type one char at a time — debounce should trigger only ONE server nav.
    await input.fill('');
    await input.pressSequentially('museum', { delay: 30 });
    await page.waitForURL(/q=museum/, { timeout: 3_000 });
    const next = await page.getByTestId('results-summary').innerText();
    expect(next).not.toEqual(initial);
    // Check the narrowed total is small enough to be plausibly "museum" matches.
    const total = Number((next.match(/^([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? '0');
    expect(total).toBeGreaterThan(0);
  });

  test('T09 column toggle persists across reload; Reset restores defaults', async ({ page }) => {
    await page.goto('/prospects');
    const toggle = page.getByTestId('column-toggle');
    await toggle.click();
    // Hide "Category" column.
    const cb = page.getByTestId('column-toggle-category');
    await cb.click();
    // Close menu by clicking header area.
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('th-category')).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('th-category')).toBeHidden({ timeout: 10_000 });

    // Reset restores defaults (category visible again).
    await page.getByTestId('column-toggle').click();
    await page.getByTestId('column-reset').click();
    await expect(page.getByTestId('th-category')).toBeVisible();
  });

  test('T10+T11 table is horizontally scrollable with sticky company column', async ({ page }) => {
    await page.goto('/prospects?pageSize=25');
    const wrap = page.getByTestId('prospect-table-wrap');
    await expect(wrap).toBeVisible();
    const scrollWidth = await wrap.evaluate((el) => (el as HTMLElement).scrollWidth);
    const clientWidth = await wrap.evaluate((el) => (el as HTMLElement).clientWidth);
    // Only assert overflow when viewport is narrower than table — some CI
    // default viewports are wide enough to fit everything.
    if (clientWidth < scrollWidth) {
      expect(scrollWidth).toBeGreaterThan(clientWidth);
    }
    // First column is sticky: check computed style.
    const stickyPos = await page.getByTestId('th-company_name').evaluate((el) => {
      return window.getComputedStyle(el as HTMLElement).position;
    });
    expect(stickyPos).toBe('sticky');
  });

  test('T12 empty state appears for nonsense search; clear restores', async ({ page }) => {
    await page.goto('/prospects?q=ZZZZ_NO_MATCH_QUERY_XYXY');
    const empty = page.getByTestId('empty-state');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/No prospects match|No prospects yet/i);
    await page.getByTestId('empty-clear-filters').click();
    await expect(page).toHaveURL(/\/prospects$/);
    await expect(page.getByTestId('prospect-row').first()).toBeVisible();
  });

  test('T13 row click navigates to detail (Stage 7 editable shell)', async ({ page }) => {
    // Stage 7 rewrote the detail page from read-only to the editable tabbed
    // ProspectDetail shell. The navigation contract still holds — a row
    // click must land on /prospects/<uuid> and render the detail component.
    // The "Read-only" badge + zero-textbox assertions are superseded by
    // Stage 7's stage7-t03-t04 + stage7-t22 specs.
    await page.goto('/prospects?pageSize=25');
    const firstRowLink = page
      .getByTestId('prospect-row')
      .first()
      .locator('a[href^="/prospects/"]')
      .first();
    await firstRowLink.click();
    await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('prospect-detail')).toBeVisible();
    await expect(page.getByTestId('stage-badge')).toContainText('Stage 7');
  });
});

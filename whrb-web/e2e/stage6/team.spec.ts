import { test, expect } from '@playwright/test';

test.describe('Stage 6 — Team', () => {
  test('T16 team grid renders every profile with an admin pill somewhere', async ({ page }) => {
    await page.goto('/team');
    await expect(page.getByTestId('team-grid')).toBeVisible();
    const members = page.getByTestId('team-member');
    expect(await members.count()).toBeGreaterThanOrEqual(1);
    // At least one admin pill rendered.
    expect(await page.getByTestId('admin-pill').count()).toBeGreaterThanOrEqual(1);
  });

  test('T17 sort toggle by Assigned switches aria-selected', async ({ page }) => {
    await page.goto('/team');
    const assignedTab = page.getByTestId('team-sort-assigned');
    await assignedTab.click();
    await expect(assignedTab).toHaveAttribute('aria-selected', 'true');
  });

  test('T18 click member → /prospects?assigned_to=<id>', async ({ page }) => {
    await page.goto('/team');
    const firstLink = page.locator('[data-testid^="team-member-link-"]').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/\/prospects\?assigned_to=[0-9a-f-]{36}/);
    await firstLink.click();
    await expect(page).toHaveURL(/\/prospects\?assigned_to=[0-9a-f-]{36}/);
    // The URL round-trips; grid either shows matching rows or empty state.
    const hasRows = await page.getByTestId('prospect-row').count();
    const hasEmpty = await page.getByTestId('empty-state').count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test('T22 floating feedback button visible on /team', async ({ page }) => {
    await page.goto('/team');
    await expect(page.getByTestId('feedback-floating-button')).toBeVisible();
  });
});

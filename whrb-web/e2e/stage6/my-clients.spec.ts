import { test, expect } from '@playwright/test';

test.describe('Stage 6 — My Clients', () => {
  test('T14+T15 My Clients shows empty-state for unassigned user with Table view default', async ({
    page,
  }) => {
    await page.goto('/my');
    // Default view is Table.
    await expect(page.getByTestId('view-table')).toHaveAttribute('aria-selected', 'true');
    // Stage 6a synthetic user has no assignments → empty state.
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toContainText(
      /No prospects assigned to you yet/i,
    );
  });

  test('T15 kanban view toggle shows Stage-7 placeholder, preserves table as default', async ({
    page,
  }) => {
    await page.goto('/my?view=kanban');
    await expect(page.getByTestId('kanban-placeholder')).toBeVisible();
    await expect(page.getByTestId('view-kanban')).toHaveAttribute('aria-selected', 'true');
  });
});

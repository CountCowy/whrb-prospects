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

  test('T15 kanban view toggle (Stage 7 replaced placeholder with real board)', async ({
    page,
  }) => {
    // Stage 7 shipped the real KanbanBoard — the Stage-6 placeholder
    // (testid=kanban-placeholder) is gone. Empty state copy is now
    // `kanban-empty-state` for unassigned users. View toggle still flips.
    await page.goto('/my?view=kanban');
    await expect(page.getByTestId('view-kanban')).toHaveAttribute('aria-selected', 'true');
    const empty = page.getByTestId('kanban-empty-state');
    const board = page.getByTestId('kanban-board');
    const visible = (await empty.isVisible()) || (await board.isVisible());
    expect(visible).toBe(true);
  });
});

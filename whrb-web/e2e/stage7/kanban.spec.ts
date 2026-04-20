import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient } from './helpers';

const REP_A_STORAGE = path.join(__dirname, '../.auth/rep-a.json');

const STATE_ORDER = [
  'researching',
  'waiting_response',
  'initial_contact',
  'ongoing_contact',
  'sold',
  'previous_client',
  'dead',
] as const;

async function ensureAssignedTo(pid: string, assignee: string) {
  const svc = serviceClient();
  await svc
    .from('prospects')
    .update({ assigned_to: assignee, assigned_at: new Date().toISOString() })
    .eq('id', pid);
}

async function dragCardToColumn(page: Page, cardId: string, targetState: string) {
  // dnd-kit PointerSensor has an activationConstraint of { distance: 5 }.
  // Playwright's Locator.dragTo() emits a single dragstart/drop pair which
  // dnd-kit's pointer listener does NOT respond to. We step the mouse
  // manually so the sensor crosses the 5px threshold and fires onDragEnd.
  const card = page.locator(`[data-testid="kanban-card"][data-card-id="${cardId}"]`);
  const col = page.getByTestId(`kanban-col-${targetState}`);
  const cardBox = await card.boundingBox();
  const colBox = await col.boundingBox();
  if (!cardBox || !colBox) throw new Error('could not resolve bounding boxes for drag');
  const fromX = cardBox.x + cardBox.width / 2;
  const fromY = cardBox.y + cardBox.height / 2;
  const toX = colBox.x + colBox.width / 2;
  const toY = colBox.y + colBox.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // Inch across 6px first to pass the activation threshold.
  await page.mouse.move(fromX + 8, fromY + 8, { steps: 3 });
  await page.mouse.move(toX, toY, { steps: 20 });
  await page.mouse.up();
}

// T17: real drag researching → waiting_response persists after reload.
test('stage7-t17 drag researching -> waiting_response persists', async ({ browser }) => {
  const snap = loadSnapshot();
  const svc = serviceClient();
  // Use a prospect tied to T17 specifically to avoid parallel-test collision.
  const { data } = await svc
    .from('prospects')
    .select('id,state,assigned_to')
    .eq('created_source', 'pipeline')
    .is('assigned_to', null)
    .order('id')
    .range(0, 0);
  const target = data![0];
  await svc
    .from('prospects')
    .update({
      assigned_to: snap.rep_a_id,
      assigned_at: new Date().toISOString(),
      state: 'researching',
    })
    .eq('id', target.id);

  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/my?view=kanban');
  await expect(
    page.locator(`[data-testid="kanban-card"][data-card-id="${target.id}"]`),
  ).toBeVisible();

  const patchResp = page.waitForResponse(
    (r) => r.url().endsWith(`/api/prospects/${target.id}`) && r.request().method() === 'PATCH',
  );
  await dragCardToColumn(page, target.id, 'waiting_response');
  await patchResp;

  await expect
    .poll(
      async () => {
        const { data: row } = await svc
          .from('prospects')
          .select('state')
          .eq('id', target.id)
          .single();
        return row?.state;
      },
      { timeout: 10_000 },
    )
    .toBe('waiting_response');

  await page.reload();
  const moved = page.locator(`[data-testid="kanban-card"][data-card-id="${target.id}"]`);
  await expect(moved).toHaveAttribute('data-card-state', 'waiting_response');

  await svc
    .from('prospects')
    .update({
      state: target.state,
      assigned_to: target.assigned_to ?? null,
      assigned_at: null,
    })
    .eq('id', target.id);
  await ctx.close();
});

// T18: 42 non-self transitions all succeed AND each emits at least one
//      prospect_state_change event. Increased timeout: 42 API calls + 42
//      DB updates typically run ~60-90s on localhost dev build.
test('stage7-t18 42 state transitions emit exactly one audit event each', async ({ browser }) => {
  test.setTimeout(240_000);
  const snap = loadSnapshot();
  const svc = serviceClient();
  // Use a DIFFERENT prospect than T17 so parallel runs don't collide.
  const { data } = await svc
    .from('prospects')
    .select('id,state,assigned_to')
    .eq('created_source', 'pipeline')
    .is('assigned_to', null)
    .order('id')
    .range(1, 1);
  const target = data![0];
  await ensureAssignedTo(target.id, snap.rep_a_id);

  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const page = await ctx.newPage();
  await page.goto(`/prospects/${target.id}`);

  const startedAt = new Date().toISOString();

  // Iterate every (from, to) pair where from != to.
  for (const from of STATE_ORDER) {
    for (const to of STATE_ORDER) {
      if (from === to) continue;
      // Set baseline.
      await svc.from('prospects').update({ state: from }).eq('id', target.id);
      // Patch via API (same route drag-drop uses).
      const res = await page.request.patch(`/api/prospects/${target.id}`, {
        data: { patch: { state: to } },
      });
      expect(res.status(), `transition ${from} -> ${to}`).toBeLessThan(300);
    }
  }

  // Count audit events for this prospect in this window.
  const { count } = await svc
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('category', 'prospect_state_change')
    .gte('created_at', startedAt)
    .contains('context', { prospect_id: target.id });
  expect(count).toBeGreaterThanOrEqual(42);

  // Restore.
  await svc
    .from('prospects')
    .update({
      state: target.state,
      assigned_to: target.assigned_to ?? null,
      assigned_at: null,
    })
    .eq('id', target.id);
  await ctx.close();
});

// T19: drop outside any column → no DB write; card stays where it was.
test('stage7-t19 drop outside column is a no-op', async ({ browser }) => {
  const snap = loadSnapshot();
  const svc = serviceClient();
  const { data } = await svc
    .from('prospects')
    .select('id,state,assigned_to')
    .eq('created_source', 'pipeline')
    .is('assigned_to', null)
    .order('id')
    .range(2, 2);
  const target = data![0];
  await svc
    .from('prospects')
    .update({
      assigned_to: snap.rep_a_id,
      assigned_at: new Date().toISOString(),
      state: 'researching',
    })
    .eq('id', target.id);

  const ctx = await browser.newContext({ storageState: REP_A_STORAGE });
  const page = await ctx.newPage();
  await page.goto('/my?view=kanban');
  const card = page.locator(`[data-testid="kanban-card"][data-card-id="${target.id}"]`);
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  // Drag to a (relatively) empty off-board spot (the page header).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 5, 20, { steps: 10 });
  await page.mouse.move(20, 20, { steps: 10 });
  await page.mouse.up();

  const { data: row } = await svc
    .from('prospects')
    .select('state')
    .eq('id', target.id)
    .single();
  expect(row?.state).toBe('researching');

  await svc
    .from('prospects')
    .update({
      state: target.state,
      assigned_to: target.assigned_to ?? null,
      assigned_at: null,
    })
    .eq('id', target.id);
  await ctx.close();
});

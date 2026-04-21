import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loadSnapshot, serviceClient, snapshotExists } from './helpers';

const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');
const REP_STORAGE = path.join(__dirname, '../.auth/stage9-rep.json');

// T11 (UI): admin PATCHes feedback.status + admin_response; user reloads
// Home and FeedbackHistory reflects the update.
// T12 (UI): admin_response is rendered in the user's FeedbackHistory item.
test('stage9-t11-t12 admin triage surfaces on user Home', async ({ browser }) => {
  test.skip(!snapshotExists(), 'Stage 9 plant snapshot missing — stage9 specs skip in CI.');
  const snap = loadSnapshot();
  const adminCtx = await browser.newContext({ storageState: ADMIN_STORAGE });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin/feedback');

  const row = adminPage.locator(
    `[data-testid="feedback-row"][data-feedback-id="${snap.seeded_feedback_id}"]`,
  );
  await expect(row).toHaveCount(1);

  // Change status → acknowledged.
  const statusResp = adminPage.waitForResponse((r) =>
    r.url().includes(`/api/admin/feedback/${snap.seeded_feedback_id}`) &&
    r.request().method() === 'PATCH',
  );
  await adminPage
    .getByTestId(`feedback-status-select-${snap.seeded_feedback_id}`)
    .selectOption('acknowledged');
  await statusResp;

  // Save admin response.
  const responseBody = '[stage9_plant_v1] thanks — we are on it';
  await adminPage
    .getByTestId(`feedback-response-${snap.seeded_feedback_id}`)
    .fill(responseBody);
  const saveResp = adminPage.waitForResponse((r) =>
    r.url().includes(`/api/admin/feedback/${snap.seeded_feedback_id}`) &&
    r.request().method() === 'PATCH',
  );
  await adminPage.getByTestId(`feedback-save-${snap.seeded_feedback_id}`).click();
  await saveResp;

  // Rep reloads Home; FeedbackHistory shows the new status + admin_response.
  const repCtx = await browser.newContext({ storageState: REP_STORAGE });
  const repPage = await repCtx.newPage();
  await repPage.goto('/');
  const historyItem = repPage
    .getByTestId('feedback-history-item')
    .filter({ hasText: '[stage9_plant_v1] stage9 plant feedback' })
    .first();
  await expect(historyItem).toHaveAttribute('data-status', 'acknowledged');
  await expect(historyItem).toContainText(responseBody);

  // Double-check DB row state.
  const svc = serviceClient();
  const { data } = await svc
    .from('feedback')
    .select('status,admin_response')
    .eq('id', snap.seeded_feedback_id)
    .maybeSingle();
  expect(data?.status).toBe('acknowledged');
  expect(data?.admin_response).toBe(responseBody);
});

/**
 * Multi-email per prospect — UI smoke (010). Local-dev only.
 *
 * Walks the rep workflow against a freshly-planted fixture prospect:
 *   K1  add first email → primary, count=1, table cell shows it
 *   K2  add second email → not primary, "+1" badge in the table cell
 *   K3  promote second to primary → primary indicator moves
 *   K4  delete primary while another exists → successor promoted
 *   K5  delete last email → cell shows "—"
 *
 * Self-contained: creates the fixture via service-role in beforeAll, tears
 * it down in afterAll.
 *
 * Skipped on CI because the fixture is assigned to the shared synthetic
 * e2e user (so the rep can edit it as the assignee). With Playwright's
 * `fullyParallel: true`, that pollutes the user's "assigned" state during
 * the run window, which breaks stage6/my-clients' empty-state assertion
 * in another worker. The DB-level integrity test
 * (whrb-prospects/scripts/multi_email_integrity.py) walks the same K1-K5
 * scenarios via psycopg2 and is the canonical correctness signal; this
 * spec exists to sanity-check the UI surface during local development.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FIXTURE_BUSINESS_KEY_PREFIX = 'e2e-multi-email-';
const E2E_USER_EMAIL =
  process.env.E2E_USER_EMAIL ?? 'stage6a-smoke@example.com';

function getEnv(name: string, ...aliases: string[]): string | null {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  return null;
}

const supabaseUrl =
  getEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const credsAvailable = Boolean(supabaseUrl && serviceKey);

let service: SupabaseClient | null = null;
let prospectId: string | null = null;

test.describe('multi-email contact-emails editor (010)', () => {
  test.skip(!credsAvailable, 'service-role creds not in env');
  test.skip(
    Boolean(process.env.CI),
    "skipped on CI: fixture pollutes the shared e2e user's assigned state during parallel runs and breaks stage6/my-clients. DB-level coverage in scripts/multi_email_integrity.py is the canonical signal.",
  );

  test.beforeAll(async () => {
    service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Resolve the e2e user's id so we can assign the fixture to them.
    const { data: list, error: listErr } = await service.auth.admin.listUsers({
      perPage: 200,
    });
    if (listErr) throw listErr;
    const userRow = list.users.find(
      (u) => (u.email ?? '').toLowerCase() === E2E_USER_EMAIL.toLowerCase(),
    );
    if (!userRow) {
      throw new Error(
        `e2e user ${E2E_USER_EMAIL} not found — auth.setup.ts should have created it`,
      );
    }
    // Defensive cleanup of any prior fixtures.
    await service
      .from('prospects')
      .delete()
      .like('business_key', `${FIXTURE_BUSINESS_KEY_PREFIX}%`);

    const businessKey = `${FIXTURE_BUSINESS_KEY_PREFIX}${Date.now()}`;
    const { data: insert, error: insertErr } = await service
      .from('prospects')
      .insert({
        business_key: businessKey,
        company_name: 'Multi-email e2e fixture',
        assigned_to: userRow.id,
        created_source: 'manual',
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;
    prospectId = insert.id as string;
  });

  test.afterAll(async () => {
    if (service && prospectId) {
      await service.from('prospects').delete().eq('id', prospectId);
    }
  });

  test('K1-K5 walks the rep multi-email workflow', async ({ page }) => {
    expect(prospectId).not.toBeNull();
    const detailUrl = `/prospects/${prospectId}`;

    // ---- K1: add first email -------------------------------------------- //
    await page.goto(detailUrl);
    await expect(
      page.getByTestId('contact-emails-editor'),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('contact-email-add-button').click();
    await page.getByTestId('contact-email-add-input').fill('foo@a.com');
    await page.getByTestId('contact-email-add-save').click();

    const list = page.getByTestId('contact-emails-list');
    await expect(list).toBeVisible({ timeout: 5_000 });
    const fooRow = list
      .locator('[data-testid^="contact-email-row-"]')
      .filter({ hasText: 'foo@a.com' });
    await expect(fooRow).toHaveCount(1);
    await expect(fooRow).toHaveAttribute('data-primary', 'true');

    // Navigate to all prospects with a search filter so the fixture row
    // surfaces on page 1 regardless of priority_score sort. The
    // contact_email column is default-visible post-010 so the value
    // renders in the table cell.
    await page.goto('/prospects?q=Multi-email+e2e+fixture');
    await expect(page.getByText('foo@a.com', { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // ---- K2: add second email ------------------------------------------- //
    await page.goto(detailUrl);
    await page.getByTestId('contact-email-add-button').click();
    await page.getByTestId('contact-email-add-input').fill('bar@b.com');
    await page.getByTestId('contact-email-add-save').click();

    const barRow = page
      .locator('[data-testid^="contact-email-row-"]')
      .filter({ hasText: 'bar@b.com' });
    await expect(barRow).toHaveCount(1);
    await expect(barRow).toHaveAttribute('data-primary', 'false');
    // Foo still primary after K2.
    await expect(
      page
        .locator('[data-testid^="contact-email-row-"]')
        .filter({ hasText: 'foo@a.com' }),
    ).toHaveAttribute('data-primary', 'true');

    // Table cell: primary still foo@a.com plus a "+1" badge.
    await page.goto('/prospects?q=Multi-email+e2e+fixture');
    await expect(
      page.getByTestId(`contact-email-extra-${prospectId}`),
    ).toContainText('+1', { timeout: 15_000 });

    // ---- K3: promote bar to primary ------------------------------------- //
    await page.goto(detailUrl);
    const barRowDetail = page
      .locator('[data-testid^="contact-email-row-"]')
      .filter({ hasText: 'bar@b.com' });
    await barRowDetail
      .locator('[data-testid^="contact-email-set-primary-"]')
      .click();
    await expect(barRowDetail).toHaveAttribute('data-primary', 'true', {
      timeout: 5_000,
    });
    await expect(
      page
        .locator('[data-testid^="contact-email-row-"]')
        .filter({ hasText: 'foo@a.com' }),
    ).toHaveAttribute('data-primary', 'false');

    // ---- K4: delete primary (bar) while foo exists ---------------------- //
    await barRowDetail
      .locator('[data-testid^="contact-email-delete-"]')
      .click();
    await page.getByTestId('contact-emails-delete-confirm').click();
    await expect(
      page
        .locator('[data-testid^="contact-email-row-"]')
        .filter({ hasText: 'bar@b.com' }),
    ).toHaveCount(0, { timeout: 5_000 });
    await expect(
      page
        .locator('[data-testid^="contact-email-row-"]')
        .filter({ hasText: 'foo@a.com' }),
    ).toHaveAttribute('data-primary', 'true');

    // ---- K5: delete last email ----------------------------------------- //
    await page
      .locator('[data-testid^="contact-email-row-"]')
      .filter({ hasText: 'foo@a.com' })
      .locator('[data-testid^="contact-email-delete-"]')
      .click();
    await page.getByTestId('contact-emails-delete-confirm').click();
    await expect(
      page.locator('[data-testid^="contact-email-row-"]'),
    ).toHaveCount(0, { timeout: 5_000 });
    // Empty state.
    await expect(page.getByTestId('contact-emails-editor')).toContainText('—');
  });
});

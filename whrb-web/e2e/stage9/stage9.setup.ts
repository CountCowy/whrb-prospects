import { test as setup, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadSnapshot } from './helpers';

const ADMIN_EMAIL = 'kingyareh@gmail.com';
const ADMIN_STORAGE = path.join(__dirname, '../.auth/admin.json');
const REP_STORAGE = path.join(__dirname, '../.auth/stage9-rep.json');

function requireEnv(name: string, ...aliases: string[]): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var: ${[name, ...aliases].join(' / ')}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function landMagiclink({
  page,
  baseURL,
  email,
  storagePath,
}: {
  page: Page;
  baseURL: string;
  email: string;
  storagePath: string;
}) {
  const supabaseUrl = requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr) throw new Error(`generateLink failed for ${email}: ${linkErr.message}`);
  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error(`no hashed_token for ${email}`);

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed for ${email}: ${verifyErr.message}`);
  const accessToken = verified.session?.access_token;
  const refreshToken = verified.session?.refresh_token;
  if (!accessToken || !refreshToken) throw new Error(`no tokens for ${email}`);

  await page.goto(
    `${baseURL}/login#access_token=${accessToken}&refresh_token=${refreshToken}&type=magiclink`,
  );
  await page.waitForFunction(
    () => /sb-[^=]+-auth-token(\.\d+)?=/.test(document.cookie),
    { timeout: 30_000 },
  );
  await page.goto(`${baseURL}/`);
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(baseURL)}/$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome,', {
    timeout: 15_000,
  });
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  await page.context().storageState({ path: storagePath });
}

setup('stage9 · authenticate admin + synthetic rep', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be set in playwright.config.ts');
  const snap = loadSnapshot();

  // Reset the synthetic rep to a clean state so repeated Playwright runs
  // are idempotent (prior runs may leave the rep deactivated or elevated
  // to admin).
  const service = createClient(
    requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await service
    .from('profiles')
    .update({ role: 'rep', deactivated_at: null })
    .eq('id', snap.synthetic_rep_id);

  await landMagiclink({ page, baseURL, email: ADMIN_EMAIL, storagePath: ADMIN_STORAGE });
  await page.context().clearCookies();
  await landMagiclink({
    page,
    baseURL,
    email: snap.synthetic_rep_email,
    storagePath: REP_STORAGE,
  });
});

export { ADMIN_STORAGE, REP_STORAGE };

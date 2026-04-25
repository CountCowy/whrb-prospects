import { test as setup, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  ADMIN_STORAGE,
  REP_A_STORAGE,
  REP_B_STORAGE,
  loadSnapshot,
  snapshotExists,
} from './helpers';

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

setup('t3 · authenticate admin + reps a/b', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be set in playwright.config.ts');
  setup.skip(!snapshotExists(), 'T3 snapshot missing — run scripts/t3_plant.py');

  const snap = loadSnapshot();
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'kingyareh@gmail.com';

  await landMagiclink({
    page,
    baseURL,
    email: adminEmail,
    storagePath: ADMIN_STORAGE,
  });
  await page.context().clearCookies();
  await landMagiclink({
    page,
    baseURL,
    email: snap.rep_a_email,
    storagePath: REP_A_STORAGE,
  });
  await page.context().clearCookies();
  await landMagiclink({
    page,
    baseURL,
    email: snap.rep_b_email,
    storagePath: REP_B_STORAGE,
  });
});

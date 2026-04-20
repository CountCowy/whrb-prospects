import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// Synthetic user the e2e harness authenticates as. Kept at `example.com` so
// no real mailbox receives anything — we never rely on an actual email, we
// verify the token_hash directly through the anon client and hand off to the
// app via its hash-token fallback (`LoginForm`'s useEffect).
//
// `stage6_plant.py` in later stages owns teardown; Stage 6a leaves the user
// in place so the harness stays idempotent across runs. A subsequent stage's
// cleanup script (Stage 6 onward) will delete it via `auth.admin.deleteUser`.
export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? 'stage6a-smoke@example.com';

const STORAGE_PATH = path.join(__dirname, '.auth/user.json');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireEnv(name: string, ...aliases: string[]): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  throw new Error(
    `Missing required env var: ${[name, ...aliases].join(' / ')}. ` +
      `Populate whrb-web/.env.local locally, or set as a GitHub Actions secret in CI.`,
  );
}

setup('authenticate synthetic e2e user', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be set in playwright.config.ts');

  // Surface browser console + page errors to the Playwright report so auth
  // failures are diagnosable without re-running with --debug.
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser ${msg.type()}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.log('[browser pageerror]', err.message);
  });

  const supabaseUrl = requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Ensure the synthetic user exists (idempotent).
  //    `listUsers` paginates; a single page of 200 is plenty for dev.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existing = list.users.find(
    (u) => (u.email ?? '').toLowerCase() === E2E_USER_EMAIL.toLowerCase(),
  );
  if (!existing) {
    const { error } = await admin.auth.admin.createUser({
      email: E2E_USER_EMAIL,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
  }

  // 2. Mint a one-time `hashed_token` for this user. No email is sent — we
  //    consume the token directly below via `verifyOtp`.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: E2E_USER_EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error('generateLink returned no hashed_token');

  // 3. Exchange the token_hash for a full session via the anon client.
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  const accessToken = verified.session?.access_token;
  const refreshToken = verified.session?.refresh_token;
  if (!accessToken || !refreshToken) throw new Error('verifyOtp did not return a usable session');

  // 4. Hand the tokens off to the app via `LoginForm`'s hash-token fallback.
  //    Keeping the exchange on-origin means we do not depend on a Supabase
  //    Auth "Redirect URL" allowlist entry for localhost.
  await page.goto(
    `${baseURL}/login#access_token=${accessToken}&refresh_token=${refreshToken}&type=magiclink`,
  );

  // 5. Wait for the `@supabase/ssr` browser client to flush its auth cookie
  //    after `LoginForm`'s `setSession` resolves. Polling cookie presence is
  //    more reliable than waiting on the client-side `router.replace('/')` —
  //    in dev mode React StrictMode double-invokes the useEffect and the
  //    router call can race with the effect's cleanup, leaving the URL at
  //    `/login` even though the session cookie is set.
  await page.waitForFunction(() => /sb-[^=]+-auth-token(\.\d+)?=/.test(document.cookie), {
    timeout: 30_000,
  });

  // 6. Cookies are live — drive ourselves to Home. The middleware will see the
  //    authenticated user and let the request through.
  await page.goto(`${baseURL}/`);
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(baseURL)}/$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome,', {
    timeout: 15_000,
  });

  // 6. Persist authenticated cookies for dependent projects.
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_PATH });
});

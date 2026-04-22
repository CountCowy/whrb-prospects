#!/usr/bin/env node
// Mint an admin sign-in link via @supabase/supabase-js (Node). Mirrors
// the Playwright setup flow which is known to produce valid tokens on
// projects using asymmetric JWT signing keys — unlike the Python
// supabase-py path which was failing with ECDSA verification errors.
//
// Usage:
//   node whrb-web/scripts/mint-magic-link.mjs <email> [baseUrl]

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
let env = {};
try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|(.*))\s*$/);
    if (m) env[m[1]] = m[2] ?? m[3];
  }
} catch (e) {
  console.error('Could not read .env.local:', e.message);
  process.exit(2);
}

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const email = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://localhost:3000';
if (!email) {
  console.error('Usage: mint-magic-link.mjs <email> [baseUrl]');
  process.exit(2);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
});
if (linkErr) {
  console.error('generateLink failed:', linkErr.message);
  process.exit(1);
}
const tokenHash = link.properties?.hashed_token;
if (!tokenHash) {
  console.error('no hashed_token in generateLink response');
  process.exit(1);
}

const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
  token_hash: tokenHash,
  type: 'magiclink',
});
if (verifyErr) {
  console.error('verifyOtp failed:', verifyErr.message);
  process.exit(1);
}
const accessToken = verified.session?.access_token;
const refreshToken = verified.session?.refresh_token;
if (!accessToken || !refreshToken) {
  console.error('no session tokens in verifyOtp response');
  process.exit(1);
}

console.log(
  `${baseUrl.replace(/\/$/, '')}/login#access_token=${accessToken}&refresh_token=${refreshToken}&type=magiclink`,
);

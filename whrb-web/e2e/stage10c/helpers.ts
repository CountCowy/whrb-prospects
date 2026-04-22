import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  'stage10c_snapshot.json',
);

export type Stage10cSnapshot = {
  started_at_iso: string;
  marker: string;
  fixture_tag: string;
  feedback_prefix: string;
  fixture_password: string;
  admin_id: string;
  admin_email: string;
  rep_id: string;
  rep_email: string;
  basket_fixture_ids: string[];
  real_landscaping_ids: string[];
  cancel_targets: {
    queued_id: string;
    running_id: string;
    running_github_run_id: number;
    success_id: string;
    failed_id: string;
  };
  feedback_ids: { admin: string[]; rep: string[] };
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): Stage10cSnapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run \`.venv/bin/python scripts/stage10c_plant.py\` in whrb-prospects/ before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Stage10cSnapshot;
}

function requireEnv(name: string, ...aliases: string[]): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var: ${[name, ...aliases].join(' / ')}`);
}

export function serviceClient() {
  return createClient(
    requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const ADMIN_STORAGE = path.join(__dirname, '../.auth/stage10c-admin.json');
export const REP_STORAGE = path.join(__dirname, '../.auth/stage10c-rep.json');

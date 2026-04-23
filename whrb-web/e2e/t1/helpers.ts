import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  't1_snapshot.json',
);

export type T1Snapshot = {
  schema_version: string;
  stage_started_at: string;
  admin_id: string;
  rep_id: string;
  prospect_id: string;
  rep_email: string;
  rep_password: string;
  prospect_business_key: string;
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): T1Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run \`.venv/bin/python scripts/t1_plant.py\` in whrb-prospects/ before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as T1Snapshot;
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

export const ADMIN_STORAGE = path.join(__dirname, '../.auth/t1-admin.json');
export const REP_STORAGE = path.join(__dirname, '../.auth/t1-rep.json');

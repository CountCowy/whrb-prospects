import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  't3_snapshot.json',
);

export type T3Snapshot = {
  stage_started_at: string;
  admin_id: string;
  rep_a_id: string;
  rep_a_email: string;
  rep_a_password: string;
  rep_b_id: string;
  rep_b_email: string;
  rep_b_password: string;
  prospect_id: string;
  tag_row_ids: Record<string, string>;
  pending_vocab_ids: Record<string, string>;
  fixture_prospect_payload: Record<string, unknown>;
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): T3Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run scripts/t3_plant.py before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as T3Snapshot;
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

export const ADMIN_STORAGE = path.join(__dirname, '../.auth/t3-admin.json');
export const REP_A_STORAGE = path.join(__dirname, '../.auth/t3-rep-a.json');
export const REP_B_STORAGE = path.join(__dirname, '../.auth/t3-rep-b.json');

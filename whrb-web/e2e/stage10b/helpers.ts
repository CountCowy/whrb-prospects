import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  'stage10b_snapshot.json',
);

export type Stage10bSnapshot = {
  started_at_iso: string;
  marker: string;
  fixture_tag: string;
  fixture_password: string;
  admin_id: string;
  admin_email: string;
  rep_a_id: string;
  rep_a_email: string;
  rep_b_id: string;
  rep_b_email: string;
  fixture_prospect_ids: string[];
  presence_subject_id: string;
  presence_subject_name: string;
  notes_subject_id: string;
  real_landscaping_ids: string[];
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): Stage10bSnapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run \`.venv/bin/python scripts/stage10b_plant.py\` in whrb-prospects/ before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Stage10bSnapshot;
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

export const ADMIN_STORAGE = path.join(__dirname, '../.auth/stage10b-admin.json');
export const REP_A_STORAGE = path.join(__dirname, '../.auth/stage10b-rep-a.json');
export const REP_B_STORAGE = path.join(__dirname, '../.auth/stage10b-rep-b.json');

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  'stage10_snapshot.json',
);

export type Stage10Snapshot = {
  started_at_iso: string;
  marker: string;
  fixture_password: string;
  admin_id: string;
  admin_email: string;
  synthetic_rep_id: string;
  synthetic_rep_email: string;
  pre_pipeline_runs_count: number;
  pre_event_log_count: number;
  groups: {
    pickup_state: Array<{
      row_id: string;
      business_key: string;
      pre_assigned_to: string | null;
      pre_state: string;
      target_assigned_to: string | null;
      target_state: string;
    }>;
    phone_lock: Array<{ row_id: string; target_phone: string }>;
    notes: Array<{ row_id: string; body: string; note_id: string }>;
    nonprofit_lock: Array<{ row_id: string }>;
    email_lock: Array<unknown>;
  };
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): Stage10Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run \`.venv/bin/python scripts/stage10_plant.py\` in whrb-prospects/ before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Stage10Snapshot;
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

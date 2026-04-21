import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  'stage9_snapshot.json',
);

export type Stage9Snapshot = {
  started_at_iso: string;
  marker: string;
  fixture_password: string;
  admin_id: string;
  synthetic_rep_id: string;
  synthetic_rep_email: string;
  pre_profile_count: number;
  pre_feedback_count: number;
  source_config_pre: Array<{
    source_key: string;
    enabled: boolean;
    updated_by: string | null;
  }>;
  boston_food_snapshot: { pre_last_seen_at_max: string | null };
  invite_email: string;
  seeded_feedback_id: string;
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): Stage9Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run \`.venv/bin/python scripts/stage9_plant.py\` in whrb-prospects/ before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Stage9Snapshot;
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

export function anonClient() {
  return createClient(
    requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

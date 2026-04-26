import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_PATH = path.join(
  __dirname,
  '../../..',
  'whrb-prospects',
  'cache',
  't4_snapshot.json',
);

export type T4Snapshot = {
  stage_started_at: string;
  admin_id: string;
  rep_id: string;
  rep_email: string;
  rep_password: string;
  sold_prospect_ids: string[];
  dedupe_event_ids: string[];
  impr_anchor: string;
  impression_ids: string[];
  backdated_event_ids: Record<string, string>;
  transitional_source_keys: string[];
  changelog_id: string;
  changelog_slug: string;
  bso_id: string;
};

export function snapshotExists(): boolean {
  return fs.existsSync(SNAPSHOT_PATH);
}

export function loadSnapshot(): T4Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Missing ${SNAPSHOT_PATH}. Run scripts/t4_plant.py before the Playwright suite.`,
    );
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as T4Snapshot;
}

export const ADMIN_STORAGE = path.join(__dirname, '../.auth/t4-admin.json');
export const REP_STORAGE = path.join(__dirname, '../.auth/t4-rep.json');

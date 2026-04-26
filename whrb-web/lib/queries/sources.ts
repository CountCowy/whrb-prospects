import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * T4 source-quality metrics, status lifecycle, and admin drill-down
 * helpers. Read-only view of `source_config`, `prospects`,
 * `event_log`, `filter_impressions`, and `filter_impression_stats`.
 *
 * `close_rate` attribution: a prospect in state ∈ {sold, ongoing_contact}
 * credits *every* source whose key appears in `prospects.source` (the
 * comma-joined contributor list). Sum across sources can exceed 100% by
 * design (plan §1.3 #21).
 *
 * `duplicate_rate`: count of `event_log` rows with
 * `category='dedupe_match'` and `context->>'losing_source' = <key>`,
 * divided by `prospects` rows whose `source` contains the key.
 *
 * `searched_rate`: distinct prospect count seen in
 * `filter_impressions ∪ filter_impression_stats`, where the impression
 * row's `filter_signature` is non-default. Default = empty signature
 * (plain `/prospects` path with no extra params).
 *
 * `rows_last_run`: count of rows whose `pipeline_last_seen_at` is the
 * most recent value for that source (proxy for "produced this run").
 *
 * Query strategy: fetch source_config + raw counts in parallel and
 * compute the rates in JS — keeps SQL simple and avoids server-side
 * arithmetic round-tripping. At ~3k prospects + 9 sources the cost is
 * a fraction of a second.
 */

export type SourceStatus =
  | 'active'
  | 'sunset_proposed'
  | 'sunset'
  | 'archived';

export type SourceMetricRow = {
  source_key: string;
  enabled: boolean;
  status: SourceStatus;
  status_changed_at: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_email: string | null;
  /** Total prospects whose `source` comma-list contains this key. */
  contributed: number;
  /** Of `contributed`, those in state {sold, ongoing_contact}. */
  closed: number;
  /** Of `contributed`, those whose source list has > 1 contributor. */
  collisions: number;
  /** dedupe_match events with losing_source = this key. */
  losses: number;
  /** Distinct prospect IDs seen in any non-default filter impression. */
  searched: number;
  /** Most recent pipeline_last_seen_at for any prospect of this source. */
  last_seen_at: string | null;
  /** Approximate row count produced on the most recent run (rows whose
   *  pipeline_last_seen_at falls inside the last 24h of last_seen_at). */
  rows_last_run: number;
  /** close / contributed; 0 when contributed = 0. */
  close_rate: number;
  /** losses / contributed; 0 when contributed = 0. */
  duplicate_rate: number;
  /** searched / contributed; 0 when contributed = 0. */
  searched_rate: number;
};

const CLOSED_STATES = ['sold', 'ongoing_contact'] as const;

function dayms(n: number) {
  return n * 24 * 60 * 60 * 1000;
}

export async function listSourceMetrics(): Promise<SourceMetricRow[]> {
  const supabase = await createClient();

  const { data: configs, error: configsErr } = await supabase
    .from('source_config')
    .select(
      'source_key, enabled, status, status_changed_at, updated_at, updated_by',
    )
    .order('source_key', { ascending: true });
  if (configsErr) throw configsErr;
  const configRows = (configs ?? []) as Array<{
    source_key: string;
    enabled: boolean;
    status: SourceStatus;
    status_changed_at: string;
    updated_at: string;
    updated_by: string | null;
  }>;

  // Resolve updated_by_email lookup once.
  const ids = Array.from(
    new Set(configRows.map((r) => r.updated_by).filter((v): v is string => Boolean(v))),
  );
  const emailsById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', ids);
    for (const row of (profs ?? []) as Array<{ id: string; email: string }>) {
      emailsById.set(row.id, row.email);
    }
  }

  // Fetch every prospect's (source, state, pipeline_last_seen_at) once,
  // then bucket per source in JS. ~3-15k rows is fine for an admin page.
  const { data: prospects, error: pErr } = await supabase
    .from('prospects')
    .select('id, source, state, pipeline_last_seen_at')
    .limit(50000);
  if (pErr) throw pErr;
  const prospectRows = (prospects ?? []) as Array<{
    id: string;
    source: string | null;
    state: string;
    pipeline_last_seen_at: string | null;
  }>;

  // dedupe_match losses per source.
  const lossesBySource = new Map<string, number>();
  {
    const { data: events } = await supabase
      .from('event_log')
      .select('context')
      .eq('category', 'dedupe_match')
      .limit(100000);
    for (const row of (events ?? []) as Array<{
      context: { losing_source?: string } | null;
    }>) {
      const key = row.context?.losing_source;
      if (!key) continue;
      lossesBySource.set(key, (lossesBySource.get(key) ?? 0) + 1);
    }
  }

  // Searched-rate per prospect: union of filter_impressions (non-default
  // signature) + filter_impression_stats (any non-empty signature is
  // already non-default — we only persist non-default ones in the rollup
  // by convention; the query picks all rows here). Distinct by prospect.
  const searchedProspectIds = new Set<string>();
  {
    const [{ data: raw }, { data: rolled }] = await Promise.all([
      supabase
        .from('filter_impressions')
        .select('prospect_id, filter_signature')
        .not('filter_signature', 'is', null)
        .limit(200000),
      supabase
        .from('filter_impression_stats')
        .select('prospect_id')
        .limit(200000),
    ]);
    for (const r of (raw ?? []) as Array<{
      prospect_id: string;
      filter_signature: string | null;
    }>) {
      const sig = r.filter_signature ?? '';
      if (sig && sig.includes('=')) {
        searchedProspectIds.add(r.prospect_id);
      }
    }
    for (const r of (rolled ?? []) as Array<{ prospect_id: string }>) {
      searchedProspectIds.add(r.prospect_id);
    }
  }

  // Bucket prospect-level signals per source.
  type Bucket = {
    contributed: Set<string>;
    closed: number;
    collisions: number;
    searched: number;
    lastSeen: string | null;
  };
  const bySource = new Map<string, Bucket>();
  for (const cfg of configRows) {
    bySource.set(cfg.source_key, {
      contributed: new Set(),
      closed: 0,
      collisions: 0,
      searched: 0,
      lastSeen: null,
    });
  }

  for (const p of prospectRows) {
    if (!p.source) continue;
    const sources = p.source.split(',').map((s) => s.trim()).filter(Boolean);
    const isClosed = CLOSED_STATES.includes(
      p.state as (typeof CLOSED_STATES)[number],
    );
    const isCollision = sources.length > 1;
    const isSearched = searchedProspectIds.has(p.id);

    for (const key of sources) {
      // It's possible a prospect references a source we don't have a
      // config row for (legacy data); spawn a synthetic bucket so the
      // metric isn't dropped silently.
      let bucket = bySource.get(key);
      if (!bucket) {
        bucket = {
          contributed: new Set(),
          closed: 0,
          collisions: 0,
          searched: 0,
          lastSeen: null,
        };
        bySource.set(key, bucket);
      }
      bucket.contributed.add(p.id);
      if (isClosed) bucket.closed += 1;
      if (isCollision) bucket.collisions += 1;
      if (isSearched) bucket.searched += 1;
      if (p.pipeline_last_seen_at) {
        if (!bucket.lastSeen || p.pipeline_last_seen_at > bucket.lastSeen) {
          bucket.lastSeen = p.pipeline_last_seen_at;
        }
      }
    }
  }

  // rows_last_run = prospects with pipeline_last_seen_at within 24h of the
  // most recent value. Cheap proxy for "this run's output".
  const rowsLastRunBySource = new Map<string, number>();
  for (const [key, bucket] of bySource.entries()) {
    if (!bucket.lastSeen) {
      rowsLastRunBySource.set(key, 0);
      continue;
    }
    const cutoff = new Date(new Date(bucket.lastSeen).getTime() - dayms(1));
    let count = 0;
    for (const p of prospectRows) {
      if (!p.source) continue;
      const sources = p.source.split(',').map((s) => s.trim());
      if (!sources.includes(key)) continue;
      if (p.pipeline_last_seen_at && new Date(p.pipeline_last_seen_at) >= cutoff) {
        count += 1;
      }
    }
    rowsLastRunBySource.set(key, count);
  }

  // Now stitch it all together for each source_config row plus any
  // synthetic-only sources discovered above.
  const allKeys = new Set<string>([
    ...configRows.map((c) => c.source_key),
    ...bySource.keys(),
  ]);
  const out: SourceMetricRow[] = [];
  for (const key of Array.from(allKeys).sort()) {
    const cfg = configRows.find((c) => c.source_key === key);
    const bucket = bySource.get(key) ?? {
      contributed: new Set<string>(),
      closed: 0,
      collisions: 0,
      searched: 0,
      lastSeen: null,
    };
    const losses = lossesBySource.get(key) ?? 0;
    const contributed = bucket.contributed.size;
    const ratio = (n: number) =>
      contributed === 0 ? 0 : n / contributed;
    out.push({
      source_key: key,
      enabled: cfg?.enabled ?? false,
      status: (cfg?.status ?? 'active') as SourceStatus,
      status_changed_at: cfg?.status_changed_at ?? new Date(0).toISOString(),
      updated_at: cfg?.updated_at ?? new Date(0).toISOString(),
      updated_by: cfg?.updated_by ?? null,
      updated_by_email:
        cfg?.updated_by ? emailsById.get(cfg.updated_by) ?? null : null,
      contributed,
      closed: bucket.closed,
      collisions: bucket.collisions,
      losses,
      searched: bucket.searched,
      last_seen_at: bucket.lastSeen,
      rows_last_run: rowsLastRunBySource.get(key) ?? 0,
      close_rate: ratio(bucket.closed),
      duplicate_rate: ratio(losses),
      searched_rate: ratio(bucket.searched),
    });
  }
  return out;
}

export type ReviewCandidateRow = SourceMetricRow & {
  reasons: string[];
};

/**
 * Sources matching the §6.4 trigger criteria for a "Propose sunset"
 * recommendation:
 *   - searched_rate < 5% AND close_rate = 0, OR
 *   - bot_detected_skip events in 3 of the last 4 runs.
 *
 * Returns the same shape as `listSourceMetrics()` plus a `reasons[]`
 * field listing which trigger fired. Sources already in non-`active`
 * status are excluded — they're already past this gate.
 */
export async function listReviewCandidates(): Promise<ReviewCandidateRow[]> {
  const supabase = await createClient();

  // bot_detected_skip event fingerprint per source.
  const { data: botEvents } = await supabase
    .from('event_log')
    .select('context, pipeline_run_id')
    .eq('category', 'bot_detected_skip')
    .limit(10000);
  const botFlagsBySource = new Map<string, Set<string>>();
  for (const row of (botEvents ?? []) as Array<{
    context: { source?: string } | null;
    pipeline_run_id: string | null;
  }>) {
    const src = row.context?.source;
    if (!src) continue;
    const set = botFlagsBySource.get(src) ?? new Set<string>();
    if (row.pipeline_run_id) set.add(row.pipeline_run_id);
    botFlagsBySource.set(src, set);
  }

  // Last 4 successful or failed runs.
  const { data: runRows } = await supabase
    .from('pipeline_runs')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(4);
  const recentRunIds = new Set<string>(
    ((runRows ?? []) as Array<{ id: string }>).map((r) => r.id),
  );

  const metrics = await listSourceMetrics();
  const candidates: ReviewCandidateRow[] = [];

  for (const m of metrics) {
    if (m.status !== 'active') continue;
    const reasons: string[] = [];

    if (m.searched_rate < 0.05 && m.close_rate === 0) {
      reasons.push('searched_rate < 5% and close_rate = 0');
    }

    const recentBotFlagged = (botFlagsBySource.get(m.source_key) ?? new Set())
      .values();
    let recentBotCount = 0;
    for (const runId of recentBotFlagged) {
      if (recentRunIds.has(runId)) recentBotCount += 1;
    }
    if (recentBotCount >= 3) {
      reasons.push(
        `bot_detected_skip in ${recentBotCount} of last ${recentRunIds.size} runs`,
      );
    }

    if (reasons.length > 0) {
      candidates.push({ ...m, reasons });
    }
  }
  return candidates;
}

/** Sample prospect rows attributable to a source — used by drill-down. */
export type SourceSampleRow = {
  id: string;
  company_name: string;
  state: string;
  source: string | null;
  zip: string | null;
  pipeline_last_seen_at: string | null;
};

export async function listSourceSampleRows(
  sourceKey: string,
  limit = 25,
): Promise<SourceSampleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select('id, company_name, state, source, zip, pipeline_last_seen_at')
    .ilike('source', `%${sourceKey}%`)
    .order('pipeline_last_seen_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  // Keep only rows whose source comma-list actually contains the key
  // (ilike `%key%` would match `key2` substring otherwise).
  const rows = (data ?? []) as SourceSampleRow[];
  return rows.filter((r) =>
    (r.source ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(sourceKey),
  );
}

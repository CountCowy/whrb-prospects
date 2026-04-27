import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  resolveTagFilter,
  resolveDaypartFilter,
} from '@/lib/queries/prospect-tags';
import type { Axis } from '@/styles/tag-colors';

export const PROSPECT_COLUMNS = [
  'id',
  'company_name',
  'contact_name',
  'tier',
  'state',
  'company_phone',
  'contact_phone',
  'company_email',
  'contact_email',
  'contact_email_count',
  'website',
  'category',
  'source',
  'zip',
  'address',
  'priority_score',
  'rating',
  'review_count',
  'is_nonprofit',
  'nonprofit_source',
  'ein',
  'assigned_to',
  'pipeline_last_seen_at',
  'created_at',
] as const;

export const ALL_SELECT =
  '*, assignee:profiles!assigned_to(id,email,display_name)';

export type Prospect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  tier: 'A' | 'B' | 'C' | string;
  state: string;
  company_phone: string | null;
  contact_phone: string | null;
  company_email: string | null;
  contact_email: string | null;
  // Maintained by sync_prospect_primary_email AFTER trigger on
  // prospect_contact_emails (010). Always equals the row count for this
  // prospect on the join table.
  contact_email_count: number;
  website: string | null;
  category: string | null;
  source: string | null;
  zip: string | null;
  address: string | null;
  priority_score: number | null;
  rating: number | null;
  review_count: number | null;
  is_nonprofit: boolean | null;
  nonprofit_source: string | null;
  ein: string | null;
  assigned_to: string | null;
  pipeline_last_seen_at: string | null;
  created_at: string;
  pipeline_notes?: string | null;
  alt_fields?: Record<string, unknown> | null;
  user_overrides?: Record<string, unknown> | null;
  seasonality_window?: string | null;
  contact_linkedin?: string | null;
  contact_title?: string | null;
  sales_email?: string | null;
  business_key?: string | null;
  created_source?: string | null;
  assignee?: { id: string; email: string; display_name: string | null } | null;
};

export type ProspectListFilters = {
  q?: string;
  tier?: string;
  state?: string;
  assigned_to?: string;
  zip?: string;
  category?: string;
  source?: string;
  is_nonprofit?: 'true' | 'false';
  assigned?: 'true' | 'false';
  /**
   * Idle threshold in days. When set, the query restricts to prospects
   * whose `updated_at` is older than `now() - idle_days`. Used by the
   * home dashboard "Prospects gone quiet" tile (which combines
   * `state=ongoing_contact` with `idle_days=90`) so the click-through
   * lands on the same row set the tile counts.
   */
  idle_days?: string;
};

export type ProspectListSort = {
  field: string;
  dir: 'asc' | 'desc';
};

const SEARCH_FIELDS = [
  'company_name',
  'contact_name',
  'company_email',
  'contact_email',
  'company_phone',
  'contact_phone',
  'website',
  'category',
  'source',
];

export const DEFAULT_SORT: ProspectListSort = { field: 'priority_score', dir: 'desc' };
export const PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type ProspectListResult = {
  rows: Prospect[];
  total: number;
  page: number;
  pageSize: number;
  sort: ProspectListSort;
  filters: ProspectListFilters;
};

export async function listProspects(params: {
  filters?: ProspectListFilters;
  sort?: ProspectListSort;
  page?: number;
  pageSize?: number;
  assignedToSelf?: boolean;
  selfUserId?: string | null;
  tagFilter?: Partial<Record<Axis, string[]>>;
  daypartFilter?: string[];
}): Promise<ProspectListResult> {
  const supabase = await createClient();
  const filters = params.filters ?? {};
  const sort = params.sort ?? DEFAULT_SORT;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  // Resolve tag + daypart filters first so we know whether to apply an
  // .in('id', ...) clause. Empty intersection short-circuits to a zero-
  // row result (T3 advanced filters can produce that legitimately).
  const tagIds = await resolveTagFilter(params.tagFilter ?? {});
  const dpIds = await resolveDaypartFilter(params.daypartFilter ?? []);
  let restrictTo: string[] | null = null;
  if (tagIds !== null && dpIds !== null) {
    const dpSet = new Set(dpIds);
    restrictTo = tagIds.filter((id) => dpSet.has(id));
  } else if (tagIds !== null) {
    restrictTo = tagIds;
  } else if (dpIds !== null) {
    restrictTo = dpIds;
  }
  if (restrictTo !== null && restrictTo.length === 0) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize,
      sort,
      filters,
    };
  }

  let query = supabase
    .from('prospects')
    .select(ALL_SELECT, { count: 'exact' });

  if (restrictTo !== null) {
    // PostgREST hard-caps an IN list. 3,266 prospects fit on dev today,
    // but a bigger filter result that exceeds the URL/header budget
    // would 414. Slice to a sane upper bound; a future bump moves us to
    // a join-side resolver (out of scope here).
    const TAG_FILTER_LIMIT = 5000;
    query = query.in('id', restrictTo.slice(0, TAG_FILTER_LIMIT));
  }

  if (params.assignedToSelf && params.selfUserId) {
    query = query.eq('assigned_to', params.selfUserId);
  }

  if (filters.q && filters.q.trim()) {
    const term = filters.q.trim().replace(/[%_]/g, '');
    const orClause = SEARCH_FIELDS.map((f) => `${f}.ilike.%${term}%`).join(',');
    query = query.or(orClause);
  }

  if (filters.tier) query = query.eq('tier', filters.tier);
  if (filters.state) query = query.eq('state', filters.state);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.zip) query = query.eq('zip', filters.zip);
  if (filters.category) query = query.ilike('category', `%${filters.category}%`);
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.is_nonprofit === 'true') query = query.eq('is_nonprofit', true);
  if (filters.is_nonprofit === 'false') query = query.not('is_nonprofit', 'is', true);
  if (filters.assigned === 'false') query = query.is('assigned_to', null);
  if (filters.assigned === 'true') query = query.not('assigned_to', 'is', null);
  if (filters.idle_days) {
    const days = Number.parseInt(filters.idle_days, 10);
    if (Number.isFinite(days) && days > 0) {
      const idleCutoff = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      query = query.lt('updated_at', idleCutoff);
    }
  }

  query = query
    .order(sort.field, { ascending: sort.dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []) as unknown as Prospect[],
    total: count ?? 0,
    page,
    pageSize,
    sort,
    filters,
  };
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select(ALL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Prospect | null;
}

export type ProspectContactEmailSource =
  | 'pipeline_hunter'
  | 'pipeline_apollo'
  | 'pipeline_scraper'
  | 'manual_rep'
  | 'legacy_scalar';

export type ProspectContactEmail = {
  id: string;
  prospect_id: string;
  email: string;
  source: ProspectContactEmailSource;
  is_primary: boolean;
  added_by: string | null;
  added_at: string;
  updated_at: string;
};

const PROSPECT_CONTACT_EMAIL_COLUMNS =
  'id,prospect_id,email,source,is_primary,added_by,added_at,updated_at';

export async function listProspectContactEmails(
  prospectId: string,
): Promise<ProspectContactEmail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_contact_emails')
    .select(PROSPECT_CONTACT_EMAIL_COLUMNS)
    .eq('prospect_id', prospectId)
    .order('is_primary', { ascending: false })
    .order('added_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProspectContactEmail[];
}

export type HomeStats = {
  total: number;
  tierA: number;
  tierB: number;
  tierC: number;
  unassigned: number;
  nonprofit: number;
  myAssigned: number;
  withEmail: number;
  recent7d: number;
  /** T4 delta: prospects whose pipeline_last_seen_at is more recent than
   *  the prior pipeline run's finished_at. Approximates "new since the
   *  last refresh". Zero if there's only one (or zero) successful run. */
  newSinceLastRun: number;
  /** T4 delta: tag-change events (added + removed + suppressed) emitted
   *  since `date_trunc('week', now())`. Week-to-date counter; resets
   *  Monday 00:00 UTC. Counts the union of `prospect_tag_added` /
   *  `prospect_tag_removed` / `prospect_tag_suppressed` audit-trigger
   *  events so soft-clears (compliance) AND hard-deletes (other axes)
   *  are both reflected — matches plan §6.4 #2 "rows created or
   *  deleted". Lock/unlock toggles are excluded; they're not "changes
   *  to which tags are on the prospect". */
  tagChangesThisWeek: number;
  /** T4 delta: prospects in state ongoing_contact whose updated_at is
   *  older than 90 days. The T4 plan calls this state `active_client`;
   *  we map it to the schema's `ongoing_contact`. */
  goneQuiet: number;
};

export async function getHomeStats(selfUserId: string): Promise<HomeStats> {
  const supabase = await createClient();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // Week-to-date boundary in UTC: most recent Monday 00:00 UTC. Reset on
  // the Monday boundary per plan §6.4 #2.
  const now = new Date();
  const dayUtc = now.getUTCDay(); // 0=Sun, 1=Mon, …
  const daysSinceMon = (dayUtc + 6) % 7; // Mon=0, Sun=6
  const weekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon),
  );
  const weekStartIso = weekStart.toISOString();

  // Resolve "prior pipeline run finish" — the most recent successful run
  // older than now. If there's none, fall back to `epoch` so the count is 0.
  const { data: priorRunRows } = await supabase
    .from('pipeline_runs')
    .select('finished_at')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(2);
  const priorFinishedAt = (priorRunRows && priorRunRows[1]?.finished_at) || null;

  const queries = await Promise.all([
    supabase.from('prospects').select('id', { count: 'exact', head: true }),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('tier', 'A'),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('tier', 'B'),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('tier', 'C'),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).is('assigned_to', null),
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('is_nonprofit', true),
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', selfUserId),
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .not('company_email', 'is', null),
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgoIso),
    // T4 delta: new since last run.
    priorFinishedAt
      ? supabase
          .from('prospects')
          .select('id', { count: 'exact', head: true })
          .gt('pipeline_last_seen_at', priorFinishedAt)
      : Promise.resolve({ count: 0, error: null } as { count: number; error: null }),
    // T4 delta: tag changes this week — counts the audit-trigger events
    // (added + removed + suppressed) so both insertion AND deletion
    // surface in the tile, matching plan §6.4 #2 "rows created or
    // deleted". The previous form `prospect_tags.created_at >= weekStart`
    // missed every clear (hard delete or compliance suppression).
    supabase
      .from('event_log')
      .select('id', { count: 'exact', head: true })
      .in('category', [
        'prospect_tag_added',
        'prospect_tag_removed',
        'prospect_tag_suppressed',
      ])
      .gte('created_at', weekStartIso),
    // T4 delta: ongoing_contact + updated_at older than 90d.
    supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'ongoing_contact')
      .lt('updated_at', ninetyDaysAgoIso),
  ]);
  return {
    total: queries[0].count ?? 0,
    tierA: queries[1].count ?? 0,
    tierB: queries[2].count ?? 0,
    tierC: queries[3].count ?? 0,
    unassigned: queries[4].count ?? 0,
    nonprofit: queries[5].count ?? 0,
    myAssigned: queries[6].count ?? 0,
    withEmail: queries[7].count ?? 0,
    recent7d: queries[8].count ?? 0,
    newSinceLastRun: queries[9].count ?? 0,
    tagChangesThisWeek: queries[10].count ?? 0,
    goneQuiet: queries[11].count ?? 0,
  };
}

export type FilterFacets = {
  tiers: string[];
  states: string[];
  sources: string[];
  categories: string[];
};

export async function getFilterFacets(): Promise<FilterFacets> {
  // Use static enumerations rather than distinct queries — schema pins tier/state
  // enums, sources come from config.py SOURCE_KEYS, categories live in pipeline
  // output. A distinct probe on 3k rows isn't worth a round-trip every load.
  const tiers = ['A', 'B', 'C'];
  const states = [
    'researching',
    'waiting_response',
    'initial_contact',
    'ongoing_contact',
    'sold',
    'previous_client',
    'dead',
  ];
  const sources = [
    'hsba',
    'artsboston',
    'osm',
    'yelp',
    'ma_hic',
    'bbb',
    'program_books',
    'best_of_boston',
    'huntington',
    'boston_food',
    'cambridge_licenses',
    'somerville_licenses',
    'ma_sos',
  ];
  return { tiers, states, sources, categories: [] };
}

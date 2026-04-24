import 'server-only';

import { createClient } from '@/lib/supabase/server';

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
}): Promise<ProspectListResult> {
  const supabase = await createClient();
  const filters = params.filters ?? {};
  const sort = params.sort ?? DEFAULT_SORT;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  let query = supabase
    .from('prospects')
    .select(ALL_SELECT, { count: 'exact' });

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
};

export async function getHomeStats(selfUserId: string): Promise<HomeStats> {
  const supabase = await createClient();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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

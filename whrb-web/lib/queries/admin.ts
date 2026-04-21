import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type SourceConfigRow = {
  source_key: string;
  enabled: boolean;
  extra_args: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
  updated_by_email: string | null;
};

export async function listSourceConfigs(): Promise<SourceConfigRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('source_config')
    .select('source_key, enabled, extra_args, updated_at, updated_by')
    .order('source_key', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<SourceConfigRow, 'updated_by_email'>>;
  const ids = Array.from(
    new Set(rows.map((r) => r.updated_by).filter((v): v is string => Boolean(v))),
  );
  const emailsById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id,email')
      .in('id', ids);
    for (const row of (profs ?? []) as Array<{ id: string; email: string }>) {
      emailsById.set(row.id, row.email);
    }
  }
  return rows.map((r) => ({
    ...r,
    updated_by_email: r.updated_by ? emailsById.get(r.updated_by) ?? null : null,
  }));
}

export type PipelineRunRow = {
  id: string;
  triggered_by: string | null;
  triggered_by_email: string | null;
  status: 'queued' | 'running' | 'success' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  rows_upserted: number | null;
  error: string | null;
  args: string | null;
  created_at: string;
};

export async function listPipelineRuns(options: {
  page: number;
  pageSize: number;
}): Promise<{ rows: PipelineRunRow[]; total: number }> {
  const supabase = await createClient();
  const from = options.page * options.pageSize;
  const to = from + options.pageSize - 1;
  const { data, error, count } = await supabase
    .from('pipeline_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<PipelineRunRow, 'triggered_by_email'>>;
  const ids = Array.from(
    new Set(rows.map((r) => r.triggered_by).filter((v): v is string => Boolean(v))),
  );
  const emailsById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id,email')
      .in('id', ids);
    for (const row of (profs ?? []) as Array<{ id: string; email: string }>) {
      emailsById.set(row.id, row.email);
    }
  }
  return {
    rows: rows.map((r) => ({
      ...r,
      triggered_by_email: r.triggered_by
        ? emailsById.get(r.triggered_by) ?? null
        : null,
    })),
    total: count ?? 0,
  };
}

export async function getPipelineRun(
  id: string,
): Promise<{ run: PipelineRunRow | null; events: EventLogRow[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const run = (data ?? null) as Omit<PipelineRunRow, 'triggered_by_email'> | null;

  let triggeredByEmail: string | null = null;
  if (run?.triggered_by) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', run.triggered_by)
      .maybeSingle();
    triggeredByEmail = (prof?.email as string | undefined) ?? null;
  }

  const { data: logs, error: lErr } = await supabase
    .from('event_log')
    .select('*')
    .eq('pipeline_run_id', id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (lErr) throw lErr;

  return {
    run: run ? { ...run, triggered_by_email: triggeredByEmail } : null,
    events: (logs ?? []) as EventLogRow[],
  };
}

export type AdminProfile = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'rep';
  created_at: string;
  deactivated_at: string | null;
};

export async function listAdminProfiles(): Promise<AdminProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminProfile[];
}

export type EventLogRow = {
  id: string;
  source: 'pipeline' | 'web_server' | 'web_client';
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string | null;
  message: string;
  context: Record<string, unknown>;
  user_id: string | null;
  pipeline_run_id: string | null;
  url: string | null;
  http_status: number | null;
  created_at: string;
};

export type EventLogFilters = {
  level?: EventLogRow['level'] | 'all';
  category?: string;
  q?: string;
  since?: string;
  until?: string;
};

export async function listEventLog(
  filters: EventLogFilters,
  options: { page: number; pageSize: number },
): Promise<{ rows: EventLogRow[]; total: number }> {
  const supabase = await createClient();
  const from = options.page * options.pageSize;
  const to = from + options.pageSize - 1;

  let q = supabase
    .from('event_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (filters.level && filters.level !== 'all') q = q.eq('level', filters.level);
  if (filters.category) q = q.eq('category', filters.category);
  if (filters.q) q = q.ilike('message', `%${filters.q}%`);
  if (filters.since) q = q.gte('created_at', filters.since);
  if (filters.until) q = q.lte('created_at', filters.until);

  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { rows: (data ?? []) as EventLogRow[], total: count ?? 0 };
}

export async function listEventLogCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('event_log')
    .select('category')
    .not('category', 'is', null)
    .limit(1000);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ category: string | null }>) {
    if (row.category) set.add(row.category);
  }
  return Array.from(set).sort();
}

export type AdminFeedbackRow = {
  id: string;
  author_id: string | null;
  author_email: string | null;
  category: 'bug' | 'idea' | 'data_issue' | 'other';
  body: string;
  page_url: string | null;
  user_agent: string | null;
  status: 'new' | 'acknowledged' | 'in_progress' | 'closed';
  admin_response: string | null;
  created_at: string;
};

export async function listAdminFeedback(): Promise<AdminFeedbackRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<AdminFeedbackRow, 'author_email'>>;
  const ids = Array.from(
    new Set(rows.map((r) => r.author_id).filter((v): v is string => Boolean(v))),
  );
  const emailsById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id,email')
      .in('id', ids);
    for (const row of (profs ?? []) as Array<{ id: string; email: string }>) {
      emailsById.set(row.id, row.email);
    }
  }
  return rows.map((r) => ({
    ...r,
    author_email: r.author_id ? emailsById.get(r.author_id) ?? null : null,
  }));
}

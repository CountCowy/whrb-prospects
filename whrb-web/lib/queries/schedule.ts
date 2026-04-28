import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ScheduleCategory } from '@/styles/schedule-colors';

export type ScheduleAssigneeKind = 'user' | 'team_wide' | 'admin';
export type ScheduleEventVisibility = 'public' | 'private';
export type ScheduleReminderChannel = 'in_app' | 'email';

export type ScheduleEvent = {
  id: string;
  series_id: string | null;
  title: string;
  description: string | null;
  category: ScheduleCategory;
  starts_at: string;
  duration_minutes: number;
  all_day: boolean;
  assignee_kind: ScheduleAssigneeKind;
  assigned_to: string | null;
  author_id: string | null;
  prospect_id: string | null;
  location: string | null;
  url: string | null;
  visibility: ScheduleEventVisibility;
  metadata: Record<string, unknown>;
  external_source: string | null;
  external_calendar_id: string | null;
  external_id: string | null;
  external_synced_at: string | null;
  created_at: string;
  updated_at: string;
  author?: { id: string; email: string; display_name: string | null } | null;
  assignee?: { id: string; email: string; display_name: string | null } | null;
  prospect?: { id: string; company_name: string } | null;
};

export type ScheduleEventReminder = {
  id: string;
  event_id: string;
  recipient_id: string;
  channel: ScheduleReminderChannel;
  lead_minutes: number;
  fire_at: string;
  dispatched_at: string | null;
  notification_id: string | null;
  created_at: string;
};

const EVENT_SELECT =
  '*, ' +
  'author:profiles!author_id(id,email,display_name), ' +
  'assignee:profiles!assigned_to(id,email,display_name), ' +
  'prospect:prospects!prospect_id(id,company_name)';

export type ListScheduleParams = {
  from: string; // ISO
  to: string; // ISO
  category?: ScheduleCategory[];
  assigneeKind?: ScheduleAssigneeKind;
  assignedTo?: string;
  prospectId?: string;
  scope?: 'mine' | 'team' | 'all';
  selfUserId?: string | null;
};

export async function listScheduleEvents(
  params: ListScheduleParams,
): Promise<ScheduleEvent[]> {
  const supabase = await createClient();
  let query = supabase
    .from('schedule_events')
    .select(EVENT_SELECT)
    .gte('starts_at', params.from)
    .lt('starts_at', params.to)
    .order('starts_at', { ascending: true })
    .limit(500);

  if (params.category && params.category.length > 0) {
    query = query.in('category', params.category);
  }
  if (params.assigneeKind) {
    query = query.eq('assignee_kind', params.assigneeKind);
  }
  if (params.assignedTo) {
    query = query.eq('assigned_to', params.assignedTo);
  }
  if (params.prospectId) {
    query = query.eq('prospect_id', params.prospectId);
  }
  if (params.scope === 'mine' && params.selfUserId) {
    query = query.or(
      `author_id.eq.${params.selfUserId},assigned_to.eq.${params.selfUserId}`,
    );
  } else if (params.scope === 'team') {
    query = query.eq('visibility', 'public');
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ScheduleEvent[];
}

export async function getScheduleEvent(
  id: string,
): Promise<ScheduleEvent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_events')
    .select(EVENT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ScheduleEvent) ?? null;
}

export async function getUpcomingScheduleForUser(
  userId: string,
  days = 14,
): Promise<ScheduleEvent[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 86_400_000);
  return listScheduleEvents({
    from: now.toISOString(),
    to: horizon.toISOString(),
    scope: 'mine',
    selfUserId: userId,
  });
}

export async function listEventReminders(
  eventId: string,
  selfUserId: string,
): Promise<ScheduleEventReminder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_event_reminders')
    .select('*')
    .eq('event_id', eventId)
    .eq('recipient_id', selfUserId)
    .order('lead_minutes', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduleEventReminder[];
}

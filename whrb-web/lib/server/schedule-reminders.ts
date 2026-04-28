import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/logging/server';
import {
  DEFAULT_SCHEDULE_PREFS,
  mergeWithDefaults,
  type SchedulePrefs,
} from '@/lib/queries/schedule-prefs';
import type { ScheduleCategory } from '@/styles/schedule-colors';
import type {
  ScheduleAssigneeKind,
  ScheduleReminderChannel,
} from '@/lib/queries/schedule';

type RecipientRow = { id: string };

type EventLite = {
  id: string;
  category: ScheduleCategory;
  assignee_kind: ScheduleAssigneeKind;
  assigned_to: string | null;
};

export async function resolveRecipients(
  evt: EventLite,
): Promise<string[]> {
  const supabase = createServiceClient();
  if (evt.assignee_kind === 'user') {
    return evt.assigned_to ? [evt.assigned_to] : [];
  }
  if (evt.assignee_kind === 'team_wide') {
    // Restrict to roles that participate in the sales motion. The plan
    // names "rep" and "admin" as the universe; future contractor/guest
    // roles must opt in explicitly.
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .is('deactivated_at', null)
      .in('role', ['admin', 'rep']);
    return ((data ?? []) as RecipientRow[]).map((r) => r.id);
  }
  // admin
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .is('deactivated_at', null)
    .eq('role', 'admin');
  return ((data ?? []) as RecipientRow[]).map((r) => r.id);
}

/**
 * Bulk-load `prefs` for the given user IDs, returning a Map.
 * Replaces the per-recipient roundtrip that used to N+1 the table.
 */
async function loadPrefsBulk(
  userIds: string[],
): Promise<Map<string, SchedulePrefs>> {
  const out = new Map<string, SchedulePrefs>();
  if (userIds.length === 0) return out;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('user_schedule_preferences')
    .select('user_id, prefs')
    .in('user_id', userIds);
  for (const row of (data ?? []) as Array<{ user_id: string; prefs: unknown }>) {
    out.set(
      row.user_id,
      mergeWithDefaults(row.prefs as Partial<SchedulePrefs> | null),
    );
  }
  // Anyone with no row yet gets the in-memory defaults.
  for (const id of userIds) {
    if (!out.has(id)) out.set(id, mergeWithDefaults(null));
  }
  return out;
}

/**
 * Materialize default reminders for an event based on each recipient's
 * per-category preferences. Idempotent via the (event_id, recipient_id,
 * channel, lead_minutes) unique constraint — re-running is safe.
 *
 * Pass `recipientId` to materialize for a single user only (used by the
 * "revert to defaults" path so one user's revert doesn't ripple writes
 * to every team-wide recipient).
 */
export async function materializeRemindersForEvent(
  eventId: string,
  recipientId?: string,
): Promise<{ inserted: number }> {
  const supabase = createServiceClient();
  const { data: evt, error: evtErr } = await supabase
    .from('schedule_events')
    .select('id, category, assignee_kind, assigned_to')
    .eq('id', eventId)
    .maybeSingle();
  if (evtErr || !evt) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'schedule_materialize_failed',
      message: 'event not found while materializing reminders',
      context: { event_id: eventId, error: evtErr?.message },
    });
    return { inserted: 0 };
  }

  let recipients = await resolveRecipients(evt as EventLite);
  if (recipientId) {
    recipients = recipients.includes(recipientId) ? [recipientId] : [];
  }
  if (recipients.length === 0) return { inserted: 0 };

  const prefsByUser = await loadPrefsBulk(recipients);

  const rows: Array<{
    event_id: string;
    recipient_id: string;
    channel: ScheduleReminderChannel;
    lead_minutes: number;
    fire_at: string;
  }> = [];
  for (const userId of recipients) {
    const prefs = prefsByUser.get(userId) ?? mergeWithDefaults(null);
    const cat =
      prefs[(evt as EventLite).category] ?? DEFAULT_SCHEDULE_PREFS.other;
    for (const lead of cat.lead_minutes) {
      for (const channel of cat.channels) {
        rows.push({
          event_id: eventId,
          recipient_id: userId,
          channel,
          lead_minutes: lead,
          // fire_at is overwritten by the derive_schedule_reminder_fire_at
          // trigger; we still send a placeholder so the column NOT NULL
          // constraint accepts the row. The table's CHECK
          // (fire_at > '2000-01-01') would catch a missing-trigger
          // regression.
          fire_at: new Date('2001-01-01T00:00:00.000Z').toISOString(),
        });
      }
    }
  }

  if (rows.length === 0) return { inserted: 0 };
  const { error: insErr, count } = await supabase
    .from('schedule_event_reminders')
    .upsert(rows, {
      onConflict: 'event_id,recipient_id,channel,lead_minutes',
      ignoreDuplicates: true,
      count: 'exact',
    });
  if (insErr) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'schedule_materialize_failed',
      message: 'reminder upsert failed',
      context: { event_id: eventId, error: insErr.message },
    });
    return { inserted: 0 };
  }
  return { inserted: count ?? rows.length };
}

/**
 * Drop pending reminders for an event (used when assignee changes mid-life;
 * caller is expected to re-materialize after).
 */
export async function clearPendingReminders(eventId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('schedule_event_reminders')
    .delete()
    .eq('event_id', eventId)
    .is('dispatched_at', null);
}

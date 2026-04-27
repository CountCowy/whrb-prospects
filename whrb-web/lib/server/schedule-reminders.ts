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
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .is('deactivated_at', null);
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

async function getPrefsFor(userId: string): Promise<SchedulePrefs> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('user_schedule_preferences')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle();
  return mergeWithDefaults(
    (data?.prefs ?? null) as Partial<SchedulePrefs> | null,
  );
}

/**
 * Materialize default reminders for an event based on each recipient's
 * per-category preferences. Idempotent via the (event_id, recipient_id,
 * channel, lead_minutes) unique constraint — re-running is safe.
 */
export async function materializeRemindersForEvent(
  eventId: string,
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

  const recipients = await resolveRecipients(evt as EventLite);
  if (recipients.length === 0) return { inserted: 0 };

  const rows: Array<{
    event_id: string;
    recipient_id: string;
    channel: ScheduleReminderChannel;
    lead_minutes: number;
    fire_at: string;
  }> = [];
  for (const userId of recipients) {
    const prefs = await getPrefsFor(userId);
    const cat = prefs[(evt as EventLite).category] ?? DEFAULT_SCHEDULE_PREFS.other;
    for (const lead of cat.lead_minutes) {
      for (const channel of cat.channels) {
        rows.push({
          event_id: eventId,
          recipient_id: userId,
          channel,
          lead_minutes: lead,
          // fire_at is overwritten by the derive_schedule_reminder_fire_at
          // trigger; we still send a placeholder so the column NOT NULL
          // constraint accepts the row.
          fire_at: new Date(0).toISOString(),
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

import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ScheduleCategory } from '@/styles/schedule-colors';
import type { ScheduleReminderChannel } from '@/lib/queries/schedule';

export type CategoryPrefs = {
  lead_minutes: number[];
  channels: ScheduleReminderChannel[];
};

export type SchedulePrefs = Record<ScheduleCategory, CategoryPrefs>;

export const DEFAULT_SCHEDULE_PREFS: SchedulePrefs = {
  sold_ad_airing: { lead_minutes: [60, 1440], channels: ['in_app'] },
  client_recontact: { lead_minutes: [1440], channels: ['in_app', 'email'] },
  invoice_due: { lead_minutes: [1440, 4320], channels: ['in_app', 'email'] },
  internal_event: { lead_minutes: [60], channels: ['in_app'] },
  personal_task: { lead_minutes: [60], channels: ['in_app'] },
  other: { lead_minutes: [60], channels: ['in_app'] },
};

export async function getSchedulePrefs(userId: string): Promise<SchedulePrefs> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_schedule_preferences')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle();
  return mergeWithDefaults(
    (data?.prefs ?? null) as Partial<SchedulePrefs> | null,
  );
}

export function mergeWithDefaults(
  raw: Partial<SchedulePrefs> | null,
): SchedulePrefs {
  const out: SchedulePrefs = { ...DEFAULT_SCHEDULE_PREFS };
  if (!raw) return out;
  for (const key of Object.keys(out) as ScheduleCategory[]) {
    const incoming = raw[key];
    if (
      incoming &&
      Array.isArray(incoming.lead_minutes) &&
      Array.isArray(incoming.channels)
    ) {
      out[key] = {
        lead_minutes: [...incoming.lead_minutes].sort((a, b) => a - b),
        channels: [...incoming.channels],
      };
    }
  }
  return out;
}

import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/logging/server';

export type NotificationKind =
  | 'assigned'
  | 'unassigned'
  | 'note_mention'
  | 'run_complete'
  | 'feedback_status';

export interface NotifyInput {
  recipientId: string;
  kind: NotificationKind;
  actorId?: string | null;
  prospectId?: string | null;
  payload?: Record<string, unknown>;
}

interface UserPrefs {
  user_id: string;
  notify_assignment_toast: boolean;
  notify_assignment_email: boolean;
  notify_mention_toast: boolean;
  notify_mention_email: boolean;
  notify_run_complete_email: boolean;
  notify_feedback_status_email: boolean;
}

const DEFAULT_PREFS: Omit<UserPrefs, 'user_id'> = {
  notify_assignment_toast: true,
  notify_assignment_email: true,
  notify_mention_toast: true,
  notify_mention_email: false,
  notify_run_complete_email: false,
  notify_feedback_status_email: true,
};

const EMAIL_PREF_COLUMN: Record<NotificationKind, keyof Omit<UserPrefs, 'user_id'>> = {
  assigned: 'notify_assignment_email',
  unassigned: 'notify_assignment_email',
  note_mention: 'notify_mention_email',
  run_complete: 'notify_run_complete_email',
  feedback_status: 'notify_feedback_status_email',
};

export async function getPrefs(userId: string): Promise<Omit<UserPrefs, 'user_id'>> {
  const service = createServiceClient();
  const { data } = await service
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_PREFS };
  const prefs = data as UserPrefs;
  return {
    notify_assignment_toast: prefs.notify_assignment_toast,
    notify_assignment_email: prefs.notify_assignment_email,
    notify_mention_toast: prefs.notify_mention_toast,
    notify_mention_email: prefs.notify_mention_email,
    notify_run_complete_email: prefs.notify_run_complete_email,
    notify_feedback_status_email: prefs.notify_feedback_status_email,
  };
}

export async function notify(input: NotifyInput): Promise<{ ok: boolean; notificationId?: string; error?: string }> {
  const service = createServiceClient();

  const { data, error } = await service
    .from('notifications')
    .insert({
      recipient_id: input.recipientId,
      kind: input.kind,
      actor_id: input.actorId ?? null,
      prospect_id: input.prospectId ?? null,
      payload: input.payload ?? {},
    })
    .select('id')
    .single();

  if (error || !data) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'notifications_insert_failed',
      message: `notifications insert failed for ${input.recipientId}`,
      context: {
        code: error?.code,
        message: error?.message,
        recipient_id: input.recipientId,
        kind: input.kind,
      },
      userId: input.actorId ?? null,
    });
    return { ok: false, error: error?.message ?? 'insert returned no row' };
  }

  const prefs = await getPrefs(input.recipientId);
  const emailCol = EMAIL_PREF_COLUMN[input.kind];
  const wantEmail = prefs[emailCol];

  if (wantEmail) {
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'email_skipped_no_provider',
      message: `[email stub] ${input.kind} notification to ${input.recipientId}`,
      context: {
        recipient_id: input.recipientId,
        kind: input.kind,
        prospect_id: input.prospectId ?? null,
        notification_id: data.id,
      },
      userId: input.actorId ?? null,
    });
  }

  return { ok: true, notificationId: data.id as string };
}

const MENTION_RE = /@([A-Za-z0-9][A-Za-z0-9._+-]*)/g;

export function extractMentionEmailPrefixes(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

export async function resolveMentionRecipients(
  prefixes: string[],
): Promise<Array<{ id: string; email: string; display_name: string | null }>> {
  if (prefixes.length === 0) return [];
  const service = createServiceClient();
  const orExpr = prefixes.map((p) => `email.ilike.${p}@%`).join(',');
  const { data } = await service
    .from('profiles')
    .select('id,email,display_name')
    .or(orExpr);
  return (data ?? []) as Array<{ id: string; email: string; display_name: string | null }>;
}

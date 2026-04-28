'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { formatDateTime, formatRelative } from '@/lib/time';

export type NotificationKind =
  | 'assigned'
  | 'unassigned'
  | 'note_mention'
  | 'run_complete'
  | 'feedback_status'
  | 'schedule_reminder';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  prospect_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  email_sent_at: string | null;
  created_at: string;
}

const KIND_LABEL: Record<NotificationKind, string> = {
  assigned: 'Assigned to you',
  unassigned: 'Prospect handed off',
  note_mention: 'Mentioned in a note',
  run_complete: 'Pipeline run complete',
  feedback_status: 'Feedback update',
  schedule_reminder: 'Schedule reminder',
};

function summary(n: NotificationItem): string {
  const p = n.payload;
  switch (n.kind) {
    case 'assigned':
    case 'unassigned': {
      const name = (p.prospect_name as string) ?? 'a prospect';
      const actor = (p.actor_email as string) ?? 'Someone';
      return n.kind === 'assigned'
        ? `${actor} assigned ${name} to you.`
        : `${actor} reassigned ${name} — no longer yours.`;
    }
    case 'note_mention': {
      const actor = (p.actor_email as string) ?? 'A teammate';
      return `${actor} mentioned you in a note.`;
    }
    case 'run_complete': {
      const status = (p.status as string) ?? 'complete';
      const rows = (p.rows_upserted as number | null) ?? null;
      const extra = rows !== null ? ` · ${rows.toLocaleString()} rows upserted` : '';
      return `Pipeline run ${status}${extra}.`;
    }
    case 'feedback_status': {
      const status = (p.status as string) ?? 'updated';
      return `An admin set your feedback to “${status}”.`;
    }
    case 'schedule_reminder': {
      const title = (p.title as string) ?? 'an event';
      const lead = p.lead_minutes as number | undefined;
      const leadStr = lead == null
        ? 'soon'
        : lead < 60
          ? `${lead}m`
          : lead < 1440
            ? `${Math.round(lead / 60)}h`
            : `${Math.round(lead / 1440)}d`;
      return `Reminder: ${title} (in ${leadStr}).`;
    }
    default:
      return KIND_LABEL[n.kind];
  }
}

function detailHref(n: NotificationItem): string | null {
  if (n.kind === 'schedule_reminder') {
    const startsAt = n.payload.starts_at as string | undefined;
    const dateParam = startsAt
      ? `?date=${new Date(startsAt).toISOString().slice(0, 10)}`
      : '';
    return `/schedule${dateParam}`;
  }
  if (n.prospect_id) return `/prospects/${n.prospect_id}`;
  if (n.kind === 'feedback_status') return `/`;
  if (n.kind === 'run_complete') {
    const runId = n.payload.pipeline_run_id as string | undefined;
    return runId ? `/admin/runs/${runId}` : '/admin/runs';
  }
  return null;
}

export function NotificationInbox({ initial }: { initial: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();

  const unreadCount = items.filter((i) => i.read_at === null).length;

  function patch(notif: NotificationItem, patchBody: { id: string; action: 'mark_read' | 'mark_unread' } | { action: 'mark_all_read' }) {
    startTransition(async () => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Update failed.');
        return;
      }
      const now = new Date().toISOString();
      if ('action' in patchBody && patchBody.action === 'mark_all_read') {
        setItems((old) => old.map((it) => (it.read_at ? it : { ...it, read_at: now })));
        toast.success('All notifications marked read.');
      } else if ('id' in patchBody) {
        const nextReadAt = patchBody.action === 'mark_read' ? now : null;
        setItems((old) => old.map((it) => (it.id === patchBody.id ? { ...it, read_at: nextReadAt } : it)));
      }
      // Re-run the (app)/layout.tsx server query so NotificationBell receives
      // a fresh `initialUnread` prop. Without this the bell badge stays stale
      // until full page reload — realtime UPDATE delivery is unreliable in
      // practice (depends on Supabase realtime + replica-identity config).
      router.refresh();
      void notif;
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          You&rsquo;re all caught up — no notifications yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {unreadCount > 0
            ? `${unreadCount} unread · ${items.length - unreadCount} read`
            : `All ${items.length} read`}
        </p>
        <button
          type="button"
          onClick={() => patch(items[0], { action: 'mark_all_read' })}
          disabled={unreadCount === 0 || pending}
          className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="notifications-mark-all-read"
        >
          Mark all read
        </button>
      </div>
      <ul className="divide-y divide-[hsl(var(--border-subtle))] overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
        {items.map((it) => {
          const href = detailHref(it);
          const unread = it.read_at === null;
          const content = (
            <article
              className={`flex items-start justify-between gap-3 p-4 transition-colors ${
                unread
                  ? 'bg-[hsl(var(--primary-soft))]/40 hover:bg-[hsl(var(--primary-soft))]/60'
                  : 'hover:bg-[hsl(var(--muted))]'
              }`}
              data-testid="notification-row"
              data-notification-id={it.id}
              data-unread={unread ? '1' : '0'}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {KIND_LABEL[it.kind]}
                  </span>
                  {unread ? (
                    <span className="inline-flex h-2 w-2 rounded-full bg-[hsl(var(--primary))]" aria-label="unread" />
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-[hsl(var(--foreground))]">{summary(it)}</p>
                <p
                  className="mt-1 text-xs text-[hsl(var(--muted-foreground))]"
                  title={formatDateTime(it.created_at)}
                >
                  {formatRelative(it.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  patch(it, {
                    id: it.id,
                    action: unread ? 'mark_read' : 'mark_unread',
                  });
                }}
                disabled={pending}
                className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              >
                {unread ? 'Mark read' : 'Mark unread'}
              </button>
            </article>
          );
          return (
            <li key={it.id}>
              {href ? (
                <Link
                  href={href}
                  onClick={() => {
                    if (unread) patch(it, { id: it.id, action: 'mark_read' });
                  }}
                  className="block"
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

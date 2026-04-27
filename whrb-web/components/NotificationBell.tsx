'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { NotificationKind } from '@/components/NotificationInbox';

interface TogglePrefs {
  notify_assignment_toast: boolean;
  notify_mention_toast: boolean;
}

const TOAST_PREF_COLUMN: Partial<Record<NotificationKind, keyof TogglePrefs>> = {
  assigned: 'notify_assignment_toast',
  unassigned: 'notify_assignment_toast',
  note_mention: 'notify_mention_toast',
};

const DEFAULT_TOAST_PREFS: TogglePrefs = {
  notify_assignment_toast: true,
  notify_mention_toast: true,
};

function shortSummary(row: {
  kind: NotificationKind;
  payload: Record<string, unknown> | null;
}): string {
  const p = row.payload ?? {};
  switch (row.kind) {
    case 'assigned': {
      const name = (p.prospect_name as string) ?? 'A prospect';
      return `Assigned: ${name}`;
    }
    case 'unassigned': {
      const name = (p.prospect_name as string) ?? 'A prospect';
      return `Reassigned: ${name}`;
    }
    case 'note_mention':
      return `Mentioned in a note`;
    case 'run_complete': {
      const status = (p.status as string) ?? 'complete';
      return `Pipeline run ${status}`;
    }
    case 'feedback_status': {
      const status = (p.status as string) ?? 'updated';
      return `Feedback status: ${status}`;
    }
    case 'schedule_reminder': {
      const title = (p.title as string) ?? 'event';
      return `Reminder: ${title}`;
    }
  }
}

export function NotificationBell({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const prefsRef = useRef<TogglePrefs>(DEFAULT_TOAST_PREFS);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = createClient();

    (async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('notify_assignment_toast,notify_mention_toast')
        .eq('user_id', userId)
        .maybeSingle();
      if (!mountedRef.current) return;
      if (data) {
        prefsRef.current = {
          notify_assignment_toast: data.notify_assignment_toast as boolean,
          notify_mention_toast: data.notify_mention_toast as boolean,
        };
      }
    })();

    const channel = supabase
      .channel(`notif-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (!mountedRef.current) return;
          setUnread((c) => c + 1);
          const row = payload.new as {
            kind: NotificationKind;
            payload: Record<string, unknown> | null;
          };
          const toastCol = TOAST_PREF_COLUMN[row.kind];
          const allow = toastCol ? prefsRef.current[toastCol] : false;
          if (allow) {
            toast(shortSummary(row), {
              action: {
                label: 'View',
                onClick: () => {
                  window.location.href = '/notifications';
                },
              },
            });
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (!mountedRef.current) return;
          const wasRead = (payload.old as { read_at?: string | null }).read_at;
          const nowRead = (payload.new as { read_at?: string | null }).read_at;
          if (!wasRead && nowRead) setUnread((c) => Math.max(0, c - 1));
          if (wasRead && !nowRead) setUnread((c) => c + 1);
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const displayCount = unread > 99 ? '99+' : `${unread}`;

  // Plan originally called for shadcn popover + button + separator; the
  // bell currently navigates to /notifications rather than opening an
  // inline popover inbox (that would be a new feature, not a migration).
  // Scope preservation: migrate to shadcn Button asChild wrapping the
  // Link, and keep nav semantics. Any future popover-inbox feature can
  // pick up separator + popover imports then.
  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      data-testid="notification-bell"
      data-unread-count={unread}
      className="relative"
    >
      <Link
        href="/notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        {/* Bell size is controlled by Button variant="icon"'s
            `[&_svg]:size-4` cva rule — don't set an arbitrary h-/w-
            here, or JIT class ordering will race with shadcn's default
            and the icon can render at 16px OR 18px across builds. */}
        <Bell aria-hidden="true" />
        {unread > 0 ? (
          <span
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground"
            data-testid="notification-bell-badge"
          >
            {displayCount}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

import { redirect } from 'next/navigation';
import { getAuthed } from '@/lib/server/authz';
import { createClient } from '@/lib/supabase/server';
import { NotificationInbox } from '@/components/NotificationInbox';
import type { NotificationItem } from '@/components/NotificationInbox';

export const dynamic = 'force-dynamic';

export default async function NotificationsInboxPage() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/notifications');

  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id,kind,prospect_id,actor_id,payload,read_at,email_sent_at,created_at')
    .eq('recipient_id', authz.user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  const items: NotificationItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as NotificationItem['kind'],
    prospect_id: (row.prospect_id as string | null) ?? null,
    actor_id: (row.actor_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    read_at: (row.read_at as string | null) ?? null,
    email_sent_at: (row.email_sent_at as string | null) ?? null,
    created_at: row.created_at as string,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Inbox
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Notifications</h1>
        </div>
      </div>
      <NotificationInbox initial={items} />
    </div>
  );
}

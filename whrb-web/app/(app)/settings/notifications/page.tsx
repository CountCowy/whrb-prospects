import { redirect } from 'next/navigation';
import { getAuthed } from '@/lib/server/authz';
import { createClient } from '@/lib/supabase/server';
import { NotificationPreferencesForm } from '@/components/NotificationPreferencesForm';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  notify_assignment_toast: true,
  notify_assignment_email: true,
  notify_mention_toast: true,
  notify_mention_email: false,
  notify_run_complete_email: false,
  notify_feedback_status_email: true,
};

export default async function NotificationsPreferencesPage() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/settings/notifications');

  const supabase = await createClient();
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', authz.user.id)
    .maybeSingle();

  const initial = {
    notify_assignment_toast: data?.notify_assignment_toast ?? DEFAULTS.notify_assignment_toast,
    notify_assignment_email: data?.notify_assignment_email ?? DEFAULTS.notify_assignment_email,
    notify_mention_toast: data?.notify_mention_toast ?? DEFAULTS.notify_mention_toast,
    notify_mention_email: data?.notify_mention_email ?? DEFAULTS.notify_mention_email,
    notify_run_complete_email:
      data?.notify_run_complete_email ?? DEFAULTS.notify_run_complete_email,
    notify_feedback_status_email:
      data?.notify_feedback_status_email ?? DEFAULTS.notify_feedback_status_email,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Notification preferences</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Choose which notifications reach you as an in-app toast and which send you an email
          (delivered in production; logged as a stub in dev).
        </p>
      </div>
      <NotificationPreferencesForm initial={initial} />
    </div>
  );
}

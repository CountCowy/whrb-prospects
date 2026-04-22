import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { FeedbackButton } from '@/components/FeedbackButton';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isAdmin = profile?.role === 'admin';

  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav isAdmin={isAdmin} userId={user.id} initialUnreadCount={unreadCount ?? 0} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-32">
        {children}
      </main>
      <FeedbackButton />
    </div>
  );
}

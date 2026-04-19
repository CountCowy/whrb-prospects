import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
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

  if (profile?.role !== 'admin') {
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'admin_forbidden',
      message: `non-admin ${user.id} hit admin route`,
      userId: user.id,
    });
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <h1 className="text-3xl font-semibold">403 — Forbidden</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          This page is admin-only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 border-b pb-3 text-sm">
        {[
          ['/admin/sources', 'Sources'],
          ['/admin/runs', 'Runs'],
          ['/admin/users', 'Users'],
          ['/admin/logs', 'Logs'],
          ['/admin/feedback', 'Feedback'],
          ['/admin/prospects/bulk', 'Bulk'],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-md px-3 py-1 hover:bg-[hsl(var(--muted))]"
          >
            {label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}

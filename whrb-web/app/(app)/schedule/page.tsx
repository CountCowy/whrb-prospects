import { redirect } from 'next/navigation';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import { getAuthed } from '@/lib/server/authz';
import { listScheduleEvents } from '@/lib/queries/schedule';
import { createClient } from '@/lib/supabase/server';
import { TIMEZONE } from '@/lib/time';
import { ScheduleApp } from '@/components/schedule/ScheduleApp';
import type { ScheduleCategory } from '@/styles/schedule-colors';

export const dynamic = 'force-dynamic';

const VALID_VIEWS = new Set(['month', 'agenda']);
const VALID_SCOPES = new Set(['mine', 'team', 'all']);

type SearchParams = Promise<{
  view?: string;
  date?: string;
  category?: string | string[];
  scope?: string;
}>;

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/schedule');

  const sp = await searchParams;
  const view = (VALID_VIEWS.has(sp.view ?? '') ? sp.view : 'month') as
    | 'month'
    | 'agenda';
  const anchor = parseAnchor(sp.date);
  const scope = (VALID_SCOPES.has(sp.scope ?? '') ? sp.scope : 'all') as
    | 'mine'
    | 'team'
    | 'all';
  const categories = parseCategories(sp.category);

  const { from, to } = computeWindow(view, anchor);

  const events = await listScheduleEvents({
    from: from.toISOString(),
    to: to.toISOString(),
    category: categories,
    scope,
    selfUserId: authz.user.id,
  });

  // Roster for assignee picker / detail dialog.
  const supabase = await createClient();
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id,email,display_name,role,deactivated_at')
    .is('deactivated_at', null)
    .order('email', { ascending: true });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Calendar
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Schedule</h1>
        </div>
      </div>
      <ScheduleApp
        initialEvents={events}
        currentUser={{
          id: authz.user.id,
          email: authz.user.email,
          role: authz.user.role,
        }}
        profiles={(profileRows ?? []).map((p) => ({
          id: p.id as string,
          email: p.email as string,
          display_name: (p.display_name as string | null) ?? null,
          role: (p.role as 'admin' | 'rep') ?? 'rep',
        }))}
        view={view}
        anchorIso={anchor.toISOString()}
        scope={scope}
        categories={categories}
      />
    </div>
  );
}

function parseAnchor(raw: string | undefined): Date {
  if (!raw) return new Date();
  // Date-only "YYYY-MM-DD" anchors should be interpreted as noon ET so
  // every downstream window-computation in ET treats it as the same day.
  // Otherwise `new Date('2026-04-27')` is UTC midnight, which is the
  // PREVIOUS day in ET and yields a wrong month grid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, mo, d] = raw.split('-').map((s) => Number(s));
    return fromZonedTime(new Date(y, mo - 1, d, 12, 0, 0), TIMEZONE);
  }
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseCategories(raw: string | string[] | undefined): ScheduleCategory[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : raw.split(',');
  const valid = new Set([
    'sold_ad_airing',
    'client_recontact',
    'invoice_due',
    'internal_event',
    'personal_task',
    'other',
  ]);
  return arr.filter((c): c is ScheduleCategory => valid.has(c));
}

function computeWindow(view: 'month' | 'agenda', anchor: Date) {
  // Compute the visible window in ET so it matches what the client grid
  // renders via formatInTz, regardless of the host server's local TZ.
  const et = toZonedTime(anchor, TIMEZONE);
  if (view === 'month') {
    const firstEt = new Date(et.getFullYear(), et.getMonth(), 1);
    const dow = firstEt.getDay();
    const fromEt = new Date(firstEt);
    fromEt.setDate(firstEt.getDate() - dow);
    const toEt = new Date(fromEt);
    toEt.setDate(fromEt.getDate() + 42);
    return {
      from: fromZonedTime(fromEt, TIMEZONE),
      to: fromZonedTime(toEt, TIMEZONE),
    };
  }
  const fromEt = new Date(et.getFullYear(), et.getMonth(), et.getDate(), 0, 0, 0);
  const toEt = new Date(fromEt);
  toEt.setDate(fromEt.getDate() + 30);
  return {
    from: fromZonedTime(fromEt, TIMEZONE),
    to: fromZonedTime(toEt, TIMEZONE),
  };
}

import { createClient } from '@/lib/supabase/server';
import { ExternalCalendarsTable } from '@/components/admin/ExternalCalendarsTable';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  feed_url: string;
  default_category: string;
  default_assignee_kind: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
};

export default async function AdminCalendarsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('schedule_external_calendars')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          External calendars
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          One-way sync of WHRB-wide calendars from a Google Calendar ICS feed
          URL. Add the “Secret address in iCal format” from Google Calendar
          settings. Imported events appear in the Schedule with a calendar
          icon and are read-only in the WHRB app — edits and deletes happen
          in Google.
        </p>
      </div>
      <ExternalCalendarsTable initial={(data ?? []) as Row[]} />
    </div>
  );
}

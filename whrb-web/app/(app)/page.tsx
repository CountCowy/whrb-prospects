import { createClient } from '@/lib/supabase/server';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

const STATS: { label: string; hint: string }[] = [
  { label: 'Total prospects', hint: 'Pipeline corpus' },
  { label: 'Assigned to me', hint: 'Your queue' },
  { label: 'Active this week', hint: 'Notes or edits in 7d' },
  { label: 'Tier A open', hint: 'Anchor sponsors' },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = formatInTimeZone(new Date(), TZ, "EEEE, MMMM d · h:mm a zzz");
  const firstName = user?.email?.split('@')[0] ?? 'there';

  return (
    <div className="space-y-8">
      <section className="accent-gradient -mx-4 -mt-6 rounded-none px-4 pb-8 pt-10 sm:-mx-6 sm:rounded-b-3xl sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
            WHRB 95.3 FM · Sales
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome, <span className="text-[hsl(var(--primary))]">{firstName}</span>
            <span className="text-[hsl(var(--muted-foreground))]">.</span>
          </h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{now}</p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(({ label, hint }) => (
          <div
            key={label}
            className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[hsl(var(--primary))] to-transparent opacity-40 transition-opacity group-hover:opacity-80"
            />
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              {label}
            </div>
            <div className="mt-3 font-semibold tabular-nums text-[hsl(var(--foreground))]">
              <span className="text-3xl">—</span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span className="inline-block h-1 w-1 rounded-full bg-[hsl(var(--muted-foreground))]/50" />
              {hint}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent activity</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Arrives Stage 6
          </span>
        </div>
        <div className="mt-4 space-y-2" aria-hidden="true">
          {[80, 55, 70].map((w, i) => (
            <div
              key={i}
              className="h-2 rounded-full bg-[hsl(var(--muted))]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
          Prospect edits, assignments, and notes will stream in here the moment
          Stage 6 lands.
        </p>
      </section>
    </div>
  );
}

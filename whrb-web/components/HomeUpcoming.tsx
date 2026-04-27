import Link from 'next/link';

import { formatDateTime, formatInTz } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import {
  CATEGORY_LABELS,
  SCHEDULE_COLORS,
  type ScheduleCategory,
} from '@/styles/schedule-colors';

export function HomeUpcoming({ events }: { events: ScheduleEvent[] }) {
  if (events.length === 0) {
    return (
      <section
        data-testid="home-upcoming"
        className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">
            Upcoming for you
          </h2>
          <Link
            href="/schedule"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground"
          >
            Open Schedule →
          </Link>
        </div>
        <p
          data-testid="home-upcoming-empty"
          className="mt-3 text-sm text-[hsl(var(--muted-foreground))]"
        >
          Nothing on your plate in the next two weeks.{' '}
          <Link href="/schedule" className="underline">
            Add to schedule
          </Link>
          .
        </p>
      </section>
    );
  }

  const groups = new Map<string, ScheduleEvent[]>();
  for (const evt of events) {
    const key = formatInTz(evt.starts_at, 'yyyy-MM-dd');
    const list = groups.get(key) ?? [];
    list.push(evt);
    groups.set(key, list);
  }

  return (
    <section
      data-testid="home-upcoming"
      className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">
          Upcoming for you
        </h2>
        <Link
          href="/schedule"
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-foreground"
        >
          Open Schedule →
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-[hsl(var(--border-subtle))]">
        {Array.from(groups.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, group]) => (
            <li key={day} className="py-2">
              <p className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                {formatInTz(group[0].starts_at, 'EEE, MMM d')}
              </p>
              <ul className="mt-1 space-y-1">
                {group.map((evt) => {
                  const color = SCHEDULE_COLORS[evt.category as ScheduleCategory] ??
                    SCHEDULE_COLORS.other;
                  return (
                    <li key={evt.id}>
                      <Link
                        href={`/schedule?date=${formatInTz(evt.starts_at, 'yyyy-MM-dd')}`}
                        className="flex items-center gap-2 text-sm hover:underline"
                        data-testid="home-upcoming-row"
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2 w-2 rounded-full ${color.bg}`}
                        />
                        <span className="text-[hsl(var(--muted-foreground))] tabular-nums">
                          {evt.all_day ? 'All day' : formatDateTime(evt.starts_at).split('·')[1]?.trim() ?? formatDateTime(evt.starts_at)}
                        </span>
                        <span className="font-medium">{evt.title}</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          · {CATEGORY_LABELS[evt.category as ScheduleCategory] ?? 'Other'}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
      </ul>
    </section>
  );
}

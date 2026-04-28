'use client';

import { formatDateTime, formatInTz } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import { EventCell } from '@/components/schedule/EventCell';

export type AgendaViewProps = {
  events: ScheduleEvent[];
  onSelectEvent: (e: ScheduleEvent) => void;
};

export function AgendaView({ events, onSelectEvent }: AgendaViewProps) {
  if (events.length === 0) {
    return (
      <div
        data-testid="schedule-agenda-empty"
        className="rounded-md border border-dashed p-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
      >
        No events in this range. Use the “New event” button to add one.
      </div>
    );
  }
  // Group by ET-local date.
  const groups = new Map<string, ScheduleEvent[]>();
  for (const evt of events) {
    const key = formatInTz(evt.starts_at, 'yyyy-MM-dd');
    const list = groups.get(key) ?? [];
    list.push(evt);
    groups.set(key, list);
  }
  const orderedKeys = Array.from(groups.keys()).sort();

  return (
    <div data-testid="schedule-agenda" className="space-y-4">
      {orderedKeys.map((key) => {
        const group = groups.get(key) ?? [];
        const heading = formatInTz(group[0]?.starts_at ?? new Date(), 'EEEE, MMM d');
        return (
          <section key={key} data-testid={`schedule-agenda-day-${key}`}>
            <h2 className="text-sm font-semibold tracking-tight">{heading}</h2>
            <ul className="mt-2 space-y-1">
              {group.map((evt) => (
                <li key={evt.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEvent(evt)}
                    className="flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <div className="w-32 shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                      {evt.all_day ? 'All day' : formatDateTime(evt.starts_at)}
                    </div>
                    <EventCell event={evt} compact />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

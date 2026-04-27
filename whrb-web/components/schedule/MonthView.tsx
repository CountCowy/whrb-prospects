'use client';

import {
  addDays,
  eachDayOfInterval,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { formatInTz } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import { EventCell } from '@/components/schedule/EventCell';

export type MonthViewProps = {
  anchor: Date;
  events: ScheduleEvent[];
  onSelectDay: (d: Date) => void;
  onSelectEvent: (e: ScheduleEvent) => void;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthView({
  anchor,
  events,
  onSelectDay,
  onSelectEvent,
}: MonthViewProps) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridDays = eachDayOfInterval({
    start: gridStart,
    end: addDays(gridStart, 41),
  });

  // Bucket events by ET-local date string.
  const byDay = new Map<string, ScheduleEvent[]>();
  for (const evt of events) {
    const key = formatInTz(evt.starts_at, 'yyyy-MM-dd');
    const list = byDay.get(key) ?? [];
    list.push(evt);
    byDay.set(key, list);
  }

  return (
    <div data-testid="schedule-month" className="rounded-md border">
      <div className="grid grid-cols-7 border-b text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((day) => {
          const key = formatInTz(day, 'yyyy-MM-dd');
          const dayEvents = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, anchor);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(day)}
              data-testid={`schedule-day-${key}`}
              className={`flex min-h-[88px] flex-col gap-1 border-b border-r p-1.5 text-left transition-colors hover:bg-muted ${
                inMonth ? '' : 'bg-muted/40'
              }`}
            >
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                {formatInTz(day, 'd')}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((evt) => (
                  <EventCell
                    key={evt.id}
                    event={evt}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(evt);
                    }}
                  />
                ))}
                {dayEvents.length > 3 ? (
                  <span
                    className="text-[11px] text-[hsl(var(--muted-foreground))]"
                    data-testid={`schedule-day-${key}-overflow`}
                  >
                    +{dayEvents.length - 3} more
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { Calendar as CalendarIcon, Lock } from 'lucide-react';

import { formatInTz } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import {
  CATEGORY_LABELS,
  SCHEDULE_COLORS,
  type ScheduleCategory,
} from '@/styles/schedule-colors';

export type EventCellProps = {
  event: ScheduleEvent;
  compact?: boolean;
  onClick?: (e: React.MouseEvent) => void;
};

export function EventCell({ event, compact = false, onClick }: EventCellProps) {
  const color = SCHEDULE_COLORS[event.category as ScheduleCategory] ?? SCHEDULE_COLORS.other;
  const labelTime = event.all_day ? 'All day' : formatInTz(event.starts_at, 'h:mm a');
  const isImported = event.external_source != null;
  const isPrivate = event.visibility === 'private';

  const className = `flex items-center gap-1 rounded ${color.bg} ${color.fg} ${
    compact ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]'
  } font-medium`;

  const content = (
    <>
      {isImported ? (
        <CalendarIcon className="h-3 w-3" aria-label="Imported from Google" />
      ) : null}
      {isPrivate ? <Lock className="h-3 w-3" aria-label="Private" /> : null}
      {!compact ? <span className="shrink-0 opacity-90">{labelTime}</span> : null}
      <span className="truncate">{event.title}</span>
      {compact ? (
        <span className="ml-auto text-xs opacity-80">
          {CATEGORY_LABELS[event.category as ScheduleCategory] ?? 'Other'}
        </span>
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <span data-testid="schedule-event-cell" className={className}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="schedule-event-cell"
      onClick={onClick}
      className={`${className} text-left ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
    >
      {content}
    </button>
  );
}

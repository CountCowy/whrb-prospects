import { addDays, addWeeks } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import { TIMEZONE } from '@/lib/time';

export type RecurrencePattern = 'daily' | 'weekly';

export type Recurrence = {
  pattern: RecurrencePattern;
  weekdays?: number[]; // 0=Sun..6=Sat (weekly only)
  interval?: number; // every N units; default 1
  count?: number; // total occurrences (mutually exclusive with `until`)
  until?: string; // ISO date; inclusive end
};

const MAX_OCCURRENCES = 100;

/**
 * Generate occurrences for a recurring schedule event.
 *
 * Walks dates IN America/New_York wall-clock time so that "every Mon at
 * 9:00 AM" stays at 9:00 AM ET across DST transitions. Each ET-local
 * datetime is then converted back to UTC.
 */
export function generateRecurrenceUtc(
  startUtcIso: string,
  recurrence: Recurrence,
): Date[] {
  const interval = Math.max(1, recurrence.interval ?? 1);
  const count = recurrence.count
    ? Math.min(MAX_OCCURRENCES, Math.max(1, recurrence.count))
    : null;
  const untilUtc = recurrence.until ? new Date(recurrence.until) : null;
  if (count === null && !untilUtc) {
    throw new Error('Recurrence requires either `count` or `until`.');
  }

  const startUtc = new Date(startUtcIso);
  const startEt = toZonedTime(startUtc, TIMEZONE);
  const wallHour = startEt.getHours();
  const wallMin = startEt.getMinutes();
  const wallSec = startEt.getSeconds();

  const out: Date[] = [];

  if (recurrence.pattern === 'daily') {
    let cursor = new Date(startEt);
    let safety = MAX_OCCURRENCES * interval + 1;
    while (out.length < (count ?? MAX_OCCURRENCES) && safety-- > 0) {
      const wall = withWallTime(cursor, wallHour, wallMin, wallSec);
      const utc = fromZonedTime(wall, TIMEZONE);
      if (untilUtc && utc.getTime() > untilUtc.getTime()) break;
      out.push(utc);
      cursor = addDays(cursor, interval);
    }
    return out;
  }

  // Weekly
  const weekdays =
    recurrence.weekdays && recurrence.weekdays.length > 0
      ? Array.from(new Set(recurrence.weekdays)).sort((a, b) => a - b)
      : [startEt.getDay()];

  // Anchor to the start of the week containing startEt; we'll iterate
  // week-by-week and emit occurrences for each requested weekday.
  let weekAnchor = addDays(startEt, -startEt.getDay());
  let safety = (count ?? MAX_OCCURRENCES) * 8;
  while (out.length < (count ?? MAX_OCCURRENCES) && safety-- > 0) {
    for (const dow of weekdays) {
      const occEt = withWallTime(addDays(weekAnchor, dow), wallHour, wallMin, wallSec);
      const occUtc = fromZonedTime(occEt, TIMEZONE);
      if (occUtc.getTime() < startUtc.getTime()) continue;
      if (untilUtc && occUtc.getTime() > untilUtc.getTime()) {
        return out;
      }
      out.push(occUtc);
      if (out.length >= (count ?? MAX_OCCURRENCES)) return out;
    }
    weekAnchor = addWeeks(weekAnchor, interval);
  }
  return out;
}

function withWallTime(date: Date, h: number, m: number, s: number): Date {
  const next = new Date(date);
  next.setHours(h, m, s, 0);
  return next;
}

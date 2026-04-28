import { describe, expect, it } from 'vitest';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import { generateRecurrenceUtc } from '../schedule-recurrence';

const TZ = 'America/New_York';

function etWall(date: Date): { hour: number; min: number } {
  const et = toZonedTime(date, TZ);
  return { hour: et.getHours(), min: et.getMinutes() };
}

describe('generateRecurrenceUtc', () => {
  it('generates N weekly occurrences anchored to the start day', () => {
    // Mon Jan 12 2026 09:00 ET
    const start = fromZonedTime(
      new Date(2026, 0, 12, 9, 0, 0),
      TZ,
    ).toISOString();
    const out = generateRecurrenceUtc(start, {
      pattern: 'weekly',
      weekdays: [1],
      count: 4,
    });
    expect(out).toHaveLength(4);
    for (const occ of out) {
      const { hour, min } = etWall(occ);
      expect(hour).toBe(9);
      expect(min).toBe(0);
    }
  });

  it('preserves ET wall-clock time across spring-forward DST', () => {
    // Spring-forward 2026: Sun Mar 8. Start Mon Mar 2 09:00 ET.
    const start = fromZonedTime(
      new Date(2026, 2, 2, 9, 0, 0),
      TZ,
    ).toISOString();
    const out = generateRecurrenceUtc(start, {
      pattern: 'weekly',
      weekdays: [1],
      count: 4,
    });
    expect(out).toHaveLength(4);
    for (const occ of out) {
      const { hour } = etWall(occ);
      expect(hour).toBe(9);
    }
  });

  it('respects a date-only until field as inclusive end-of-day in ET', () => {
    const start = fromZonedTime(
      new Date(2026, 5, 1, 10, 0, 0),
      TZ,
    ).toISOString();
    // Date-only string mirrors what <input type="date"> sends.
    const out = generateRecurrenceUtc(start, {
      pattern: 'weekly',
      weekdays: [1],
      until: '2026-06-22',
    });
    // Mondays in [Jun 1, Jun 22]: Jun 1, 8, 15, 22 → 4 occurrences.
    expect(out).toHaveLength(4);
  });

  it('honors a full ISO until verbatim', () => {
    const start = fromZonedTime(
      new Date(2026, 5, 1, 10, 0, 0),
      TZ,
    ).toISOString();
    // 23:00 ET on Jun 14 → Jun 8 is the last Mon strictly before this.
    const until = fromZonedTime(
      new Date(2026, 5, 14, 23, 0, 0),
      TZ,
    ).toISOString();
    const out = generateRecurrenceUtc(start, {
      pattern: 'weekly',
      weekdays: [1],
      until,
    });
    expect(out).toHaveLength(2);
  });

  it('caps daily occurrences', () => {
    const start = fromZonedTime(
      new Date(2026, 0, 1, 9, 0, 0),
      TZ,
    ).toISOString();
    const out = generateRecurrenceUtc(start, {
      pattern: 'daily',
      count: 200,
    });
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

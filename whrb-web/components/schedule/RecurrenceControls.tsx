'use client';

import { useState } from 'react';

export type RecurrenceValue = {
  pattern: 'daily' | 'weekly';
  weekdays?: number[];
  interval?: number;
  count?: number;
  until?: string;
} | null;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RecurrenceControls({
  value,
  onChange,
}: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
}) {
  const [endMode, setEndMode] = useState<'count' | 'until'>(
    value?.until ? 'until' : 'count',
  );

  if (!value) {
    return (
      <button
        type="button"
        data-testid="schedule-recurrence-toggle-on"
        onClick={() =>
          onChange({ pattern: 'weekly', weekdays: [], interval: 1, count: 4 })
        }
        className="text-xs underline"
      >
        Make recurring…
      </button>
    );
  }

  const weekdays = value.weekdays ?? [];

  return (
    <div className="space-y-2 rounded-md border p-2" data-testid="schedule-recurrence-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider">
          Recurrence
        </span>
        <button
          type="button"
          data-testid="schedule-recurrence-toggle-off"
          onClick={() => onChange(null)}
          className="text-xs underline"
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="text-xs uppercase tracking-wider">Pattern</label>
        <select
          value={value.pattern}
          onChange={(e) =>
            onChange({ ...value, pattern: e.target.value as 'daily' | 'weekly' })
          }
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
        >
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
        </select>
        <label className="ml-2 text-xs uppercase tracking-wider">Every</label>
        <input
          type="number"
          min={1}
          max={52}
          value={value.interval ?? 1}
          onChange={(e) =>
            onChange({ ...value, interval: Math.max(1, Number(e.target.value || 1)) })
          }
          className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm"
        />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {value.pattern === 'weekly' ? 'week(s)' : 'day(s)'}
        </span>
      </div>

      {value.pattern === 'weekly' ? (
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_NAMES.map((name, idx) => {
            const active = weekdays.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    weekdays: active
                      ? weekdays.filter((d) => d !== idx)
                      : [...weekdays, idx].sort((a, b) => a - b),
                  })
                }
                aria-pressed={active}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  active
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'border'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <label className="text-xs uppercase tracking-wider">Ends</label>
        <select
          value={endMode}
          onChange={(e) => {
            const next = e.target.value as 'count' | 'until';
            setEndMode(next);
            if (next === 'count') {
              onChange({ ...value, until: undefined, count: value.count ?? 4 });
            } else {
              onChange({
                ...value,
                count: undefined,
                until:
                  value.until ??
                  new Date(Date.now() + 30 * 86_400_000).toISOString(),
              });
            }
          }}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
        >
          <option value="count">After N occurrences</option>
          <option value="until">On a date</option>
        </select>
        {endMode === 'count' ? (
          <input
            type="number"
            min={1}
            max={100}
            value={value.count ?? 4}
            onChange={(e) =>
              onChange({ ...value, count: Math.max(1, Number(e.target.value || 1)) })
            }
            className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm"
          />
        ) : (
          <input
            type="date"
            value={value.until ? value.until.slice(0, 10) : ''}
            onChange={(e) =>
              onChange({ ...value, until: new Date(e.target.value).toISOString() })
            }
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
          />
        )}
      </div>
    </div>
  );
}

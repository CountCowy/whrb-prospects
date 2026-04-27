'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import {
  CATEGORY_LABELS,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
} from '@/styles/schedule-colors';
import type { SchedulePrefs } from '@/lib/queries/schedule-prefs';

const PRESETS = [
  { label: '5 m', value: 5 },
  { label: '15 m', value: 15 },
  { label: '30 m', value: 30 },
  { label: '1 h', value: 60 },
  { label: '2 h', value: 120 },
  { label: '1 d', value: 1440 },
  { label: '2 d', value: 2880 },
  { label: '1 w', value: 10_080 },
];

export function SchedulePreferencesForm({ initial }: { initial: SchedulePrefs }) {
  const [prefs, setPrefs] = useState<SchedulePrefs>(initial);
  const [pending, setPending] = useState<ScheduleCategory | null>(null);

  async function save(category: ScheduleCategory, next: SchedulePrefs[ScheduleCategory]) {
    const prev = prefs[category];
    setPrefs((p) => ({ ...p, [category]: next }));
    setPending(category);
    const res = await fetch('/api/user-schedule-preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category, prefs: next }),
    });
    setPending(null);
    if (!res.ok) {
      setPrefs((p) => ({ ...p, [category]: prev }));
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Could not save schedule preference.');
      return;
    }
    toast.success('Saved.');
  }

  return (
    <section
      data-testid="schedule-preferences"
      className="mt-8 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold">Schedule reminders</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Choose default lead times and delivery channel for each event
          category. New events you create or get added to will use these
          values; per-event overrides live in the event detail dialog.
        </p>
      </div>
      <div className="mt-4 space-y-5">
        {SCHEDULE_CATEGORIES.map((category) => {
          const cat = prefs[category];
          return (
            <div key={category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                {CATEGORY_LABELS[category]}
              </h3>
              <div className="flex flex-wrap items-center gap-1">
                {cat.lead_minutes.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    data-testid={`pref-schedule-${category}-lead-${mins}`}
                    onClick={() =>
                      save(category, {
                        ...cat,
                        lead_minutes: cat.lead_minutes.filter((m) => m !== mins),
                      })
                    }
                    disabled={pending === category}
                    className="rounded-full border bg-[hsl(var(--primary-soft))] px-2 py-0.5 text-xs text-[hsl(var(--primary))]"
                  >
                    {formatLead(mins)} ✕
                  </button>
                ))}
                <select
                  value=""
                  data-testid={`pref-schedule-${category}-leads`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!v || cat.lead_minutes.includes(v)) return;
                    save(category, {
                      ...cat,
                      lead_minutes: [...cat.lead_minutes, v].sort(
                        (a, b) => a - b,
                      ),
                    });
                  }}
                  className="rounded-md border bg-transparent px-2 py-0.5 text-xs"
                >
                  <option value="">+ add lead time…</option>
                  {PRESETS.filter((p) => !cat.lead_minutes.includes(p.value)).map(
                    (p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="flex gap-3 text-xs">
                {(['in_app', 'email'] as const).map((channel) => {
                  const enabled = cat.channels.includes(channel);
                  return (
                    <label
                      key={channel}
                      data-testid={`pref-schedule-${category}-channel-${channel}`}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={pending === category}
                        onChange={(e) =>
                          save(category, {
                            ...cat,
                            channels: e.target.checked
                              ? Array.from(new Set([...cat.channels, channel]))
                              : cat.channels.filter((c) => c !== channel),
                          })
                        }
                      />
                      {channel === 'in_app' ? 'In-app' : 'Email'}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatLead(min: number): string {
  if (min < 60) return `${min}m before`;
  if (min < 1440) return `${Math.round(min / 60)}h before`;
  return `${Math.round(min / 1440)}d before`;
}

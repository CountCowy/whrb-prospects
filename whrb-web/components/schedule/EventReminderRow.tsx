'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { ScheduleEventReminder } from '@/lib/queries/schedule';

const PRESETS = [5, 15, 30, 60, 120, 1440, 4320, 10080];

export function EventReminderRow({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<ScheduleEventReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newLead, setNewLead] = useState<number>(60);
  const [newChannel, setNewChannel] = useState<'in_app' | 'email'>('in_app');

  async function refresh() {
    setLoading(true);
    const res = await fetch(`/api/schedule/events/${eventId}/reminders`);
    if (res.ok) {
      const j = await res.json();
      setItems(j.items as ScheduleEventReminder[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // refresh is a stable closure over `eventId`; re-defining it on every
    // render would loop the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function save(next: ScheduleEventReminder[]) {
    const overrides = next.map((r) => ({
      lead_minutes: r.lead_minutes,
      channel: r.channel,
    }));
    const res = await fetch(`/api/schedule/events/${eventId}/reminders`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Could not save reminder.');
      return;
    }
    toast.success('Reminders updated.');
    void refresh();
  }

  async function revert() {
    const res = await fetch(
      `/api/schedule/events/${eventId}/reminders/revert`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Revert failed.');
      return;
    }
    toast.success('Reverted to defaults.');
    void refresh();
  }

  if (loading) {
    return (
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Loading reminders…
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="schedule-reminder-row">
      <ul className="space-y-1">
        {items.length === 0 ? (
          <li className="text-xs text-[hsl(var(--muted-foreground))]">
            No reminders set for you on this event.
          </li>
        ) : null}
        {items.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
          >
            <span>
              {formatLead(r.lead_minutes)} · {r.channel === 'email' ? 'Email' : 'In-app'}
              {r.dispatched_at ? ' · sent' : ''}
            </span>
            {!r.dispatched_at ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() =>
                  save(
                    items.filter(
                      (x) =>
                        !(
                          x.lead_minutes === r.lead_minutes &&
                          x.channel === r.channel
                        ),
                    ),
                  )
                }
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={newLead}
          onChange={(e) => setNewLead(Number(e.target.value))}
          className="rounded-md border bg-transparent px-2 py-1"
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {formatLead(p)}
            </option>
          ))}
        </select>
        <select
          value={newChannel}
          onChange={(e) => setNewChannel(e.target.value as 'in_app' | 'email')}
          className="rounded-md border bg-transparent px-2 py-1"
        >
          <option value="in_app">In-app</option>
          <option value="email">Email</option>
        </select>
        <button
          type="button"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            const next = [
              ...items.filter(
                (r) =>
                  !(r.lead_minutes === newLead && r.channel === newChannel),
              ),
              {
                id: 'temp',
                event_id: eventId,
                recipient_id: '',
                channel: newChannel,
                lead_minutes: newLead,
                fire_at: '',
                dispatched_at: null,
                notification_id: null,
                created_at: '',
              } as ScheduleEventReminder,
            ];
            await save(next);
            setAdding(false);
          }}
          className="rounded-md border px-2 py-1"
        >
          Add reminder
        </button>
        <button type="button" onClick={revert} className="text-xs underline">
          Revert to default
        </button>
      </div>
    </div>
  );
}

function formatLead(min: number): string {
  if (min < 60) return `${min}m before`;
  if (min < 1440) return `${Math.round(min / 60)}h before`;
  return `${Math.round(min / 1440)}d before`;
}

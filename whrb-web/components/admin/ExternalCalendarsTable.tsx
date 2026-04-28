'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/time';
import {
  CATEGORY_LABELS,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
} from '@/styles/schedule-colors';

type Row = {
  id: string;
  name: string;
  feed_url: string;
  default_category: string;
  default_assignee_kind: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
};

export function ExternalCalendarsTable({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [name, setName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [category, setCategory] = useState<ScheduleCategory>('internal_event');
  const [submitting, setSubmitting] = useState(false);

  async function add() {
    if (!name.trim() || !feedUrl.trim()) return;
    setSubmitting(true);
    const res = await fetch('/api/admin/schedule/external-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        feed_url: feedUrl.trim(),
        default_category: category,
        default_assignee_kind: 'team_wide',
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Could not add calendar.');
      return;
    }
    const created = (await res.json()) as Row;
    setRows((prev) => [created, ...prev]);
    setName('');
    setFeedUrl('');
    toast.success('Calendar added.');
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/schedule/external-calendars/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Update failed.');
      return;
    }
    const fresh = (await res.json()) as Row;
    setRows((prev) => prev.map((r) => (r.id === id ? fresh : r)));
  }

  async function remove(id: string) {
    if (!confirm('Remove this feed? Imported events stay but become orphaned.'))
      return;
    const res = await fetch(`/api/admin/schedule/external-calendars/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Delete failed.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success('Removed.');
  }

  async function syncNow(id: string) {
    const res = await fetch(
      `/api/admin/schedule/external-calendars/${id}/sync-now`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Sync dispatch failed.');
      return;
    }
    toast.success('Sync dispatched. Refresh in ~1 min.');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border bg-[hsl(var(--surface))] p-4">
        <h2 className="text-sm font-semibold">Add a Google Calendar feed</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-widest">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="WHRB Master Calendar"
              data-testid="ext-cal-name"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[11px] uppercase tracking-widest">
              ICS feed URL (Secret address)
            </Label>
            <Input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              data-testid="ext-cal-feed-url"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-widest">
              Default category
            </Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ScheduleCategory)}
              className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
            >
              {SCHEDULE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            disabled={submitting || !name.trim() || !feedUrl.trim()}
            onClick={add}
            data-testid="ext-cal-add"
          >
            {submitting ? 'Adding…' : '+ Add calendar'}
          </Button>
        </div>
      </section>

      <section>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No calendars connected yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                data-testid={`ext-cal-row-${r.id}`}
                className="rounded-md border bg-[hsl(var(--surface))] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.name}</p>
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {r.feed_url}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        r.last_status === 'success'
                          ? 'bg-emerald-100 text-emerald-700'
                          : r.last_status === 'failure'
                          ? 'bg-red-100 text-red-700'
                          : r.last_status === 'running'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {r.last_status ?? 'never synced'}
                    </span>
                    {r.last_synced_at ? (
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {formatDateTime(r.last_synced_at)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        patch(r.id, { enabled: e.target.checked })
                      }
                    />
                    Enabled
                  </label>
                  <select
                    value={r.default_category}
                    onChange={(e) =>
                      patch(r.id, { default_category: e.target.value })
                    }
                    className="rounded-md border bg-transparent px-2 py-1"
                  >
                    {SCHEDULE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => syncNow(r.id)}
                    data-testid={`ext-cal-sync-${r.id}`}
                  >
                    Sync now
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => remove(r.id)}
                  >
                    Remove
                  </Button>
                </div>
                {r.last_error ? (
                  <p className="mt-2 text-xs text-destructive">
                    Last error: {r.last_error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

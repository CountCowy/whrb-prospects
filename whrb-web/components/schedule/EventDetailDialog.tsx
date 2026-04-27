'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/time';
import type { ScheduleEvent } from '@/lib/queries/schedule';
import {
  CATEGORY_LABELS,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
} from '@/styles/schedule-colors';
import { EventReminderRow } from '@/components/schedule/EventReminderRow';
import type { RosterUser } from '@/components/schedule/ScheduleApp';

export type EventDetailDialogProps = {
  event: ScheduleEvent | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentUser: { id: string; email: string; role: 'admin' | 'rep' };
  profiles: RosterUser[];
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
  onDelete: (id: string, series: boolean) => Promise<boolean>;
};

export function EventDetailDialog({
  event,
  open,
  onOpenChange,
  currentUser,
  profiles,
  onUpdate,
  onDelete,
}: EventDetailDialogProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    category: ScheduleCategory;
    starts_at: string;
    duration_minutes: number;
    assignee_kind: 'user' | 'team_wide' | 'admin';
    assigned_to: string | null;
    location: string;
    visibility: 'public' | 'private';
  } | null>(null);

  useEffect(() => {
    if (!event) {
      setEditing(false);
      setDraft(null);
      return;
    }
    setDraft({
      title: event.title,
      description: event.description ?? '',
      category: event.category as ScheduleCategory,
      starts_at: event.starts_at,
      duration_minutes: event.duration_minutes,
      assignee_kind: event.assignee_kind,
      assigned_to: event.assigned_to,
      location: event.location ?? '',
      visibility: event.visibility,
    });
    setEditing(false);
  }, [event]);

  if (!event || !draft) return null;
  const imported = event.external_source != null;
  const canDelete =
    currentUser.role === 'admin' ||
    event.author_id === currentUser.id ||
    (event.assignee_kind === 'user' && event.assigned_to === currentUser.id);

  async function save() {
    if (!event || !draft) return;
    const patch: Record<string, unknown> = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      category: draft.category,
      starts_at: draft.starts_at,
      duration_minutes: draft.duration_minutes,
      assignee_kind: draft.assignee_kind,
      assigned_to: draft.assignee_kind === 'user' ? draft.assigned_to : null,
      location: draft.location.trim() || null,
      visibility: draft.visibility,
    };
    const ok = await onUpdate(event.id, patch);
    if (ok) setEditing(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="schedule-detail-dialog"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit event' : event.title}
          </DialogTitle>
        </DialogHeader>
        {imported ? (
          <div className="rounded-md border bg-muted px-3 py-2 text-xs">
            Imported from Google Calendar — managed in Google. Title, time,
            description, and assignee are read-only.
          </div>
        ) : null}

        {!editing ? (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {formatDateTime(event.starts_at)} · {event.duration_minutes} min
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {CATEGORY_LABELS[event.category as ScheduleCategory]} ·{' '}
              {event.assignee_kind === 'user'
                ? labelFor(profiles, event.assigned_to)
                : event.assignee_kind === 'team_wide'
                ? 'Team-wide'
                : 'Admins'}
              {event.visibility === 'private' ? ' · Private' : ''}
            </p>
            {event.description ? <p>{event.description}</p> : null}
            {event.location ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Location: {event.location}
              </p>
            ) : null}
            {event.prospect ? (
              <p className="text-xs">
                <Link
                  className="underline"
                  href={`/prospects/${event.prospect.id}`}
                >
                  → {event.prospect.company_name}
                </Link>
              </p>
            ) : null}
            <div className="pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                Your reminders
              </h3>
              <EventReminderRow eventId={event.id} />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Title
              </Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                disabled={imported}
                data-testid="schedule-detail-title"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <textarea
                rows={2}
                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                disabled={imported}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Starts
                </Label>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.starts_at)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      starts_at: new Date(e.target.value).toISOString(),
                    })
                  }
                  disabled={imported}
                  className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                  data-testid="schedule-detail-start"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Duration
                </Label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.duration_minutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration_minutes: Math.max(1, Number(e.target.value || 30)),
                    })
                  }
                  disabled={imported}
                  className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as ScheduleCategory })
                }
                disabled={imported}
                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                {SCHEDULE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Assignee
              </Label>
              <div className="flex gap-2">
                <select
                  value={draft.assignee_kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      assignee_kind: e.target.value as
                        | 'user'
                        | 'team_wide'
                        | 'admin',
                    })
                  }
                  disabled={imported || draft.visibility === 'private'}
                  className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="user">A specific rep</option>
                  <option value="team_wide">Team-wide</option>
                  <option value="admin">Admins</option>
                </select>
                {draft.assignee_kind === 'user' ? (
                  <select
                    value={draft.assigned_to ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, assigned_to: e.target.value || null })
                    }
                    disabled={imported}
                    className="flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
                  >
                    <option value="">Pick a rep…</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name ?? p.email}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between">
          <div className="flex gap-2">
            {!imported && canDelete ? (
              <Button
                variant="outline"
                size="sm"
                data-testid="schedule-detail-delete"
                onClick={() => onDelete(event.id, false)}
              >
                Delete
              </Button>
            ) : null}
            {!imported && event.series_id && canDelete ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(event.id, true)}
              >
                Delete series
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {!editing && !imported ? (
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  data-testid="schedule-detail-save"
                  onClick={save}
                >
                  Save
                </Button>
              </>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function labelFor(profiles: RosterUser[], id: string | null): string {
  if (!id) return 'Unassigned';
  const p = profiles.find((x) => x.id === id);
  if (!p) return 'Unknown rep';
  return p.display_name ?? p.email;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

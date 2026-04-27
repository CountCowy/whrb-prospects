'use client';

import { useEffect, useMemo, useState } from 'react';

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
import {
  CATEGORY_LABELS,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
} from '@/styles/schedule-colors';
import {
  RecurrenceControls,
  type RecurrenceValue,
} from '@/components/schedule/RecurrenceControls';
import type { RosterUser } from '@/components/schedule/ScheduleApp';

type AssigneeKind = 'user' | 'team_wide' | 'admin';

type FormState = {
  title: string;
  description: string;
  date: string;
  time: string;
  all_day: boolean;
  category: ScheduleCategory;
  duration_minutes: number;
  assignee_kind: AssigneeKind;
  assigned_to: string | null;
  visibility: 'public' | 'private';
  location: string;
  url: string;
  prospect_id: string | null;
};

export type CreateEventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: { id: string; email: string; role: 'admin' | 'rep' };
  profiles: RosterUser[];
  defaults: {
    starts_at?: string;
    prospect_id?: string | null;
    mode?: 'event' | 'task';
  };
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
};

export function CreateEventDialog({
  open,
  onOpenChange,
  currentUser,
  profiles,
  defaults,
  onSubmit,
}: CreateEventDialogProps) {
  const taskMode = defaults.mode === 'task';
  const initial = useMemo(() => initialState(currentUser.id, taskMode, defaults), [
    currentUser.id,
    taskMode,
    defaults,
  ]);
  const [form, setForm] = useState(initial);
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setRecurrence(null);
      setError(null);
    }
  }, [open, initial]);

  async function submit() {
    setError(null);
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (form.assignee_kind === 'user' && !form.assigned_to) {
      setError('Pick an assignee or change to Team-wide.');
      return;
    }
    setSubmitting(true);
    const startsAt = combineDateTime(form.date, form.time);
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category,
      starts_at: startsAt,
      duration_minutes: form.duration_minutes,
      all_day: form.all_day,
      assignee_kind: form.assignee_kind,
      assigned_to:
        form.assignee_kind === 'user' ? form.assigned_to : null,
      prospect_id: form.prospect_id || null,
      location: form.location.trim() || null,
      url: form.url.trim() || null,
      visibility: form.visibility,
    };
    if (recurrence) payload.recurrence = recurrence;
    const ok = await onSubmit(payload);
    setSubmitting(false);
    if (ok) onOpenChange(false);
  }

  const privateLocked = form.visibility === 'private';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="schedule-create-dialog"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{taskMode ? 'Add task' : 'New event'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field
            id="sched-title"
            label="Title"
            required
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
            testid="schedule-create-title"
          />
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Description
            </Label>
            <textarea
              data-testid="schedule-create-description"
              className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Date
              </Label>
              <input
                data-testid="schedule-create-date"
                type="date"
                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Time (ET)
              </Label>
              <input
                data-testid="schedule-create-time"
                type="time"
                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                disabled={form.all_day}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="schedule-create-all-day"
              checked={form.all_day}
              onChange={(e) => setForm({ ...form, all_day: e.target.checked })}
            />
            All-day event
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <select
                data-testid="schedule-create-category"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as ScheduleCategory })
                }
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
                Duration (min)
              </Label>
              <input
                data-testid="schedule-create-duration"
                type="number"
                min={1}
                max={1440}
                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                value={form.duration_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    duration_minutes: Math.max(1, Number(e.target.value || 30)),
                  })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Assignee
            </Label>
            <div className="flex gap-2">
              <select
                data-testid="schedule-create-assignee-kind"
                value={form.assignee_kind}
                onChange={(e) =>
                  setForm({ ...form, assignee_kind: e.target.value as AssigneeKind })
                }
                disabled={privateLocked}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="user">A specific rep</option>
                <option value="team_wide">Team wide</option>
                <option value="admin">Admins</option>
              </select>
              {form.assignee_kind === 'user' ? (
                <select
                  data-testid="schedule-create-assigned-to"
                  value={form.assigned_to ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, assigned_to: e.target.value || null })
                  }
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
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Location / link (optional)
            </Label>
            <Input
              data-testid="schedule-create-location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="schedule-create-private"
              checked={form.visibility === 'private'}
              onChange={(e) =>
                setForm({
                  ...form,
                  visibility: e.target.checked ? 'private' : 'public',
                  // Force user-kind + self-assigned when going private.
                  assignee_kind: e.target.checked ? 'user' : form.assignee_kind,
                  assigned_to: e.target.checked
                    ? currentUser.id
                    : form.assigned_to,
                })
              }
            />
            Private to me (only the assignee can see this)
          </label>
          <RecurrenceControls value={recurrence} onChange={setRecurrence} />
          {error ? (
            <p
              data-testid="schedule-create-error"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="schedule-create-submit"
            disabled={submitting || !form.title.trim()}
            onClick={submit}
          >
            {submitting ? 'Saving…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  required,
  value,
  onChange,
  testid,
}: {
  id?: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1">
      <Label
        htmlFor={id}
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {label}
        {required ? ' *' : ''}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </div>
  );
}

function combineDateTime(date: string, time: string): string {
  // Both inputs are in local time; build an ISO string. The form treats the
  // local browser time zone as the wall-clock — note that this differs from
  // strict America/New_York; for v1 we accept this small caveat (devs run
  // in ET; recurrence generator stays ET-anchored).
  const [h, m] = (time || '12:00').split(':').map((s) => Number(s));
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function initialState(
  selfId: string,
  taskMode: boolean,
  defaults: { starts_at?: string; prospect_id?: string | null },
): FormState {
  const start = defaults.starts_at ? new Date(defaults.starts_at) : roundToNextHour(new Date());
  const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(start.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(start.getHours()).padStart(2, '0')}:${String(
    start.getMinutes(),
  ).padStart(2, '0')}`;
  return {
    title: '',
    description: '',
    date: dateStr,
    time: timeStr,
    all_day: false,
    category: (taskMode ? 'personal_task' : 'internal_event') as ScheduleCategory,
    duration_minutes: taskMode ? 15 : 30,
    assignee_kind: (taskMode ? 'user' : 'user') as AssigneeKind,
    assigned_to: taskMode ? selfId : selfId,
    visibility: (taskMode ? 'private' : 'public') as 'public' | 'private',
    location: '',
    url: '',
    prospect_id: defaults.prospect_id ?? null,
  };
}

function roundToNextHour(d: Date): Date {
  const next = new Date(d);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

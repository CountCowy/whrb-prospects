'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/time';
import type { ActivityEntry } from '@/lib/queries/activity';

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
// Categories whose Activity-tab entry exposes an Undo button. Inverse
// of insert is delete and vice versa; the route handler reads
// `tag_id` + `prospect_id` from the event_log context.
const UNDOABLE_CATEGORIES = new Set([
  'prospect_tag_added',
  'prospect_tag_removed',
]);

function fieldLabel(field: unknown): string {
  if (typeof field !== 'string') return '';
  return field.replace(/_/g, ' ');
}

function valuePreview(raw: unknown): string {
  if (raw === null || raw === undefined) return '∅';
  if (typeof raw === 'string') return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  try {
    const s = JSON.stringify(raw);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return '(unserialisable)';
  }
}

function renderEntry(entry: ActivityEntry, profiles: Record<string, string>): string {
  const actor = entry.actor_label ?? 'pipeline';
  const ctx = entry.context as {
    field?: unknown;
    old?: unknown;
    new?: unknown;
    axis?: unknown;
    value?: unknown;
  };
  switch (entry.category) {
    case 'prospect_field_change':
      return `${actor} changed ${fieldLabel(ctx.field)} from ${valuePreview(ctx.old)} to ${valuePreview(ctx.new)}`;
    case 'prospect_state_change':
      return `${actor} moved state from ${valuePreview(ctx.old)} to ${valuePreview(ctx.new)}`;
    case 'prospect_assignment_change': {
      const oldName =
        typeof ctx.old === 'string' && ctx.old in profiles ? profiles[ctx.old] : valuePreview(ctx.old);
      const newName =
        typeof ctx.new === 'string' && ctx.new in profiles ? profiles[ctx.new] : valuePreview(ctx.new);
      return `${actor} reassigned from ${oldName} to ${newName}`;
    }
    case 'prospect_tag_added':
      return `${actor} added tag ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'prospect_tag_removed':
      return `${actor} removed tag ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'prospect_tag_locked':
      return `${actor} locked tag ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'prospect_tag_unlocked':
      return `${actor} unlocked tag ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'prospect_tag_suppressed':
      return `${actor} soft-cleared compliance ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'prospect_tag_unsuppressed':
      return `${actor} restored compliance ${valuePreview(ctx.axis)}:${valuePreview(ctx.value)}`;
    case 'compliance_cleared':
      return `${actor} flagged ${valuePreview(ctx.value)} for admin review`;
    case 'note_deleted':
      return `${actor} soft-deleted a note`;
    case 'note_restored':
      return `${actor} restored a note`;
    default:
      return `${actor}: ${entry.message}`;
  }
}

export function ActivityTab({
  entries,
  profiles,
  isAdmin,
  currentUserId,
  prospectId,
  onChanged,
}: {
  entries: ActivityEntry[];
  profiles: Record<string, string>;
  isAdmin: boolean;
  /** When set, an "Undo this change" button shows on user-owned add/remove events within 24h. */
  currentUserId?: string;
  prospectId?: string;
  onChanged?: () => void;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = entries;
    if (!showDeleted) {
      list = list.filter(
        (e) => e.category !== 'note_deleted' && e.category !== 'note_restored',
      );
    }
    const sorted = [...list].sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return newestFirst ? diff : -diff;
    });
    return sorted;
  }, [entries, showDeleted, newestFirst]);

  function isUndoable(entry: ActivityEntry): boolean {
    if (!UNDOABLE_CATEGORIES.has(entry.category ?? '')) return false;
    if (!currentUserId || !prospectId) return false;
    const actorId = (entry.context as { actor_id?: string }).actor_id;
    if (actorId !== currentUserId) return false;
    const age = Date.now() - new Date(entry.created_at).getTime();
    return age >= 0 && age < UNDO_WINDOW_MS;
  }

  async function handleUndo(entry: ActivityEntry) {
    if (!prospectId) return;
    const ctx = entry.context as { tag_id?: string };
    if (!ctx.tag_id) {
      toast.error('Missing tag_id on event — cannot undo.');
      return;
    }
    setBusyId(entry.id);
    try {
      if (entry.category === 'prospect_tag_added') {
        // Inverse of add = delete. Look up the prospect_tags row by
        // (prospect_id, tag_id), then DELETE it.
        const lookup = await fetch(`/api/prospects/${prospectId}/tags`);
        if (!lookup.ok) {
          toast.error('Failed to read prospect tags.');
          return;
        }
        const rows = (await lookup.json()) as Array<{ id: string; tag_id: string }>;
        const target = rows.find((r) => r.tag_id === ctx.tag_id);
        if (!target) {
          toast.error('Tag is no longer present — already undone?');
          return;
        }
        const res = await fetch(
          `/api/prospects/${prospectId}/tags?tag_row_id=${target.id}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? `HTTP ${res.status}`);
          return;
        }
        toast.success('Reversed.');
      } else {
        // Inverse of remove = re-insert.
        const res = await fetch(`/api/prospects/${prospectId}/tags`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tag_id: ctx.tag_id }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? `HTTP ${res.status}`);
          return;
        }
        toast.success('Restored.');
      }
      if (onChanged) onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="activity-tab">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
        <button
          type="button"
          onClick={() => setNewestFirst((v) => !v)}
          data-testid="activity-sort-toggle"
          className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 font-medium hover:text-[hsl(var(--foreground))]"
        >
          Sort: {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
        {isAdmin ? (
          <label className="flex items-center gap-2" data-testid="activity-deleted-toggle">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Include deleted note history
          </label>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <p data-testid="activity-empty" className="text-sm text-[hsl(var(--muted-foreground))]">
          No activity yet.
        </p>
      ) : (
        <ol className="space-y-2" data-testid="activity-list">
          {filtered.map((entry) => {
            const undoable = isUndoable(entry);
            return (
              <li
                key={entry.id}
                data-testid="activity-entry"
                data-category={entry.category ?? ''}
                data-undoable={undoable ? 'true' : 'false'}
                className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[hsl(var(--foreground))]">
                    {renderEntry(entry, profiles)}
                  </p>
                  <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                    {formatDateTime(entry.created_at)}
                  </p>
                </div>
                {undoable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="activity-undo-btn"
                    disabled={busyId === entry.id}
                    onClick={() => void handleUndo(entry)}
                    className="h-7 shrink-0 text-xs"
                  >
                    Undo this change
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

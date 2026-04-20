'use client';

import { useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/time';
import type { ActivityEntry } from '@/lib/queries/activity';

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
}: {
  entries: ActivityEntry[];
  profiles: Record<string, string>;
  isAdmin: boolean;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);

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
          {filtered.map((entry) => (
            <li
              key={entry.id}
              data-testid="activity-entry"
              data-category={entry.category ?? ''}
              className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] p-3"
            >
              <p className="text-sm text-[hsl(var(--foreground))]">
                {renderEntry(entry, profiles)}
              </p>
              <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                {formatDateTime(entry.created_at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatDateTime, formatRelative } from '@/lib/time';

export type NoteView = {
  id: string;
  prospect_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  author?: {
    id: string;
    email: string;
    display_name: string | null;
  } | null;
};

export type NotesPanelProps = {
  prospectId: string;
  initialNotes: NoteView[];
  currentUserId: string;
  isAdmin: boolean;
  authorLabels: Record<string, string>;
};

const NOTE_MAX = 5000;
const WARN_THRESHOLD = 4900;

export function NotesPanel({
  prospectId,
  initialNotes,
  currentUserId,
  isAdmin,
  authorLabels,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<NoteView[]>(initialNotes);
  const [showDeleted, setShowDeleted] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    const sb = supabaseRef.current;
    const channel = sb
      .channel(`prospect-notes-${prospectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prospect_notes',
          filter: `prospect_id=eq.${prospectId}`,
        },
        async (payload) => {
          const type = payload.eventType;
          if (type === 'INSERT' || type === 'UPDATE') {
            const row = payload.new as NoteView;
            setNotes((prev) => {
              const idx = prev.findIndex((n) => n.id === row.id);
              if (idx === -1) return [row, ...prev];
              const next = prev.slice();
              next[idx] = { ...prev[idx], ...row };
              return next;
            });
          } else if (type === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (oldId) setNotes((prev) => prev.filter((n) => n.id !== oldId));
          }
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [prospectId]);

  async function addNote() {
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/prospects/${prospectId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Could not save note.');
      return;
    }
    const inserted = await res.json().catch(() => null);
    if (inserted?.id) {
      const optimistic: NoteView = {
        id: inserted.id,
        prospect_id: prospectId,
        author_id: currentUserId,
        body,
        edited_at: null,
        deleted_at: null,
        deleted_by: null,
        created_at: inserted.created_at ?? new Date().toISOString(),
        author: null,
      };
      setNotes((prev) => {
        if (prev.some((n) => n.id === optimistic.id)) return prev;
        return [optimistic, ...prev];
      });
    }
    setDraft('');
  }

  async function patchNote(noteId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/prospects/${prospectId}/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Note update failed.');
      return false;
    }
    setError(null);
    if (payload.body !== undefined) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? { ...n, body: String(payload.body), edited_at: new Date().toISOString() }
            : n,
        ),
      );
    }
    if (payload.deleted === true) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                deleted_at: new Date().toISOString(),
                deleted_by: currentUserId,
              }
            : n,
        ),
      );
    }
    if (payload.restore === true) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, deleted_at: null, deleted_by: null } : n,
        ),
      );
    }
    return true;
  }

  async function deleteNote(noteId: string) {
    const res = await fetch(`/api/prospects/${prospectId}/notes/${noteId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Delete failed.');
      return;
    }
    setError(null);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              deleted_at: new Date().toISOString(),
              deleted_by: currentUserId,
            }
          : n,
      ),
    );
  }

  const counterTone =
    draft.length >= WARN_THRESHOLD
      ? 'text-red-600 dark:text-red-300'
      : 'text-[hsl(var(--muted-foreground))]';

  const visible = notes.filter((n) => (showDeleted ? true : !n.deleted_at));

  function authorName(n: NoteView): string {
    return (
      n.author?.display_name ||
      n.author?.email?.split('@')[0] ||
      authorLabels[n.author_id] ||
      'Unknown'
    );
  }

  return (
    <section
      data-testid="notes-panel"
      className="space-y-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">Notes</h2>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="notes-admin-ghost-toggle">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Show deleted (admin)
          </label>
        ) : null}
      </div>

      <div className="space-y-2">
        <textarea
          data-testid="note-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
          placeholder="Add a note…"
          className="h-24 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm"
          maxLength={NOTE_MAX}
        />
        <div className="flex items-center justify-between">
          <span data-testid="note-counter" className={`text-xs ${counterTone}`}>
            {draft.length}/{NOTE_MAX}
          </span>
          <button
            type="button"
            onClick={addNote}
            disabled={submitting || !draft.trim()}
            data-testid="note-submit"
            className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-3 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {error ? (
          <p data-testid="notes-error" className="text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p data-testid="notes-empty" className="text-sm text-[hsl(var(--muted-foreground))]">
          No notes yet.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="notes-list">
          {visible.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              authorName={authorName(n)}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onEdit={(body) => patchNote(n.id, { body })}
              onDelete={() => deleteNote(n.id)}
              onRestore={() => patchNote(n.id, { restore: true })}
              startTransition={startTransition}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteRow({
  note,
  authorName,
  currentUserId,
  isAdmin,
  onEdit,
  onDelete,
  onRestore,
  startTransition,
}: {
  note: NoteView;
  authorName: string;
  currentUserId: string;
  isAdmin: boolean;
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<boolean>;
  startTransition: (fn: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const isAuthor = note.author_id === currentUserId;
  const isDeleted = Boolean(note.deleted_at);

  async function save() {
    const ok = await onEdit(draft.trim());
    if (ok) setEditing(false);
  }

  return (
    <li
      data-testid="note-item"
      data-note-id={note.id}
      data-note-deleted={isDeleted ? 'true' : 'false'}
      className={`rounded-lg border p-3 ${
        isDeleted
          ? 'border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] opacity-60'
          : 'border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span className="font-medium text-[hsl(var(--foreground))]">{authorName}</span>
        <span
          title={formatDateTime(note.created_at)}
          className="tabular-nums"
          data-testid="note-timestamp"
        >
          {formatRelative(note.created_at)}
          {note.edited_at ? ' · edited' : ''}
          {isDeleted ? ' · deleted' : ''}
        </span>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
            data-testid="note-edit-input"
            className="h-24 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startTransition(save)}
              data-testid="note-save"
              className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(note.body);
              }}
              className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p
          className="mt-1 whitespace-pre-line text-sm"
          data-testid="note-body"
        >
          {note.body}
        </p>
      )}
      <div className="mt-2 flex gap-2 text-[11px]">
        {isAuthor && !isDeleted ? (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            data-testid="note-edit"
            className="text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
          >
            {editing ? 'Close' : 'Edit'}
          </button>
        ) : null}
        {(isAuthor || isAdmin) && !isDeleted ? (
          <button
            type="button"
            onClick={() => startTransition(onDelete)}
            data-testid="note-delete"
            className="text-red-600 underline decoration-dotted underline-offset-4 hover:text-red-700 dark:text-red-300"
          >
            Delete
          </button>
        ) : null}
        {isAdmin && isDeleted ? (
          <button
            type="button"
            onClick={() => startTransition(onRestore)}
            data-testid="note-restore"
            className="text-[hsl(var(--primary))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
          >
            Restore
          </button>
        ) : null}
      </div>
    </li>
  );
}

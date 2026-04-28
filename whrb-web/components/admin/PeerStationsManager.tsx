'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  PeerStationRow,
  PeerStationStatus,
} from '@/lib/queries/peer-stations';

const STATUSES: ReadonlyArray<PeerStationStatus> = ['active', 'deprecated'];

const SELECT_CLASS =
  'flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function deriveNormalizedName(display: string): string {
  return display
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function PeerStationsManager({
  initialRows,
}: {
  initialRows: PeerStationRow[];
}) {
  const [rows, setRows] = useState<PeerStationRow[]>(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const groups: Record<PeerStationStatus, PeerStationRow[]> = {
      active: [],
      deprecated: [],
    };
    for (const r of rows) groups[r.status].push(r);
    return groups;
  }, [rows]);

  function refresh(updated: PeerStationRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleCreate(formData: FormData) {
    const display = String(formData.get('display_name') ?? '').trim();
    if (!display) {
      toast.error('Display name is required.');
      return;
    }
    const normalized = String(formData.get('normalized_name') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim() || null;
    startTransition(async () => {
      const res = await fetch('/api/admin/peer-stations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: display,
          normalized_name: normalized || undefined,
          notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const created = (await res.json()) as PeerStationRow;
      setRows((prev) => [...prev, created]);
      toast.success(`Added ${created.display_name}`);
    });
  }

  async function handlePatch(id: string, body: Partial<PeerStationRow>) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await fetch(`/api/admin/peer-stations/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? `HTTP ${res.status}`);
          resolve();
          return;
        }
        const updated = (await res.json()) as PeerStationRow;
        refresh(updated);
        toast.success(`Updated ${updated.display_name}`);
        resolve();
      });
    });
  }

  async function handleDelete(row: PeerStationRow) {
    const ok = confirm(
      `Delete peer station "${row.display_name}"?\n\nNext pipeline run will stop suppressing scraped rows that match "${row.normalized_name}". This cannot be undone — to soft-disable, set status to "deprecated" instead.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/peer-stations/${row.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `HTTP ${res.status}`);
        return;
      }
      remove(row.id);
      toast.success(`Deleted ${row.display_name}`);
    });
  }

  return (
    <div className="space-y-8">
      <section
        className="rounded-lg border bg-[hsl(var(--card))] p-4"
        data-testid="peer-stations-create"
      >
        <h2 className="text-base font-semibold">Add peer station</h2>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Display name = how the entity appears in copy (&ldquo;WGBH&rdquo;,
          &ldquo;GBH FM&rdquo;). Normalized name = lowercase alnum-only used
          for substring matching; leave blank to derive from display name
          automatically.
        </p>
        <form
          action={handleCreate}
          className="mt-3 grid gap-3 sm:grid-cols-[2fr_2fr_3fr_auto]"
        >
          <div>
            <Label htmlFor="ps-display">Display name</Label>
            <Input
              id="ps-display"
              name="display_name"
              required
              maxLength={120}
              placeholder="WBOZ FM"
              data-testid="peer-stations-input-display"
            />
          </div>
          <div>
            <Label htmlFor="ps-norm">Normalized (optional)</Label>
            <Input
              id="ps-norm"
              name="normalized_name"
              maxLength={120}
              placeholder="wboz"
              pattern="[a-z0-9 ]+"
              data-testid="peer-stations-input-normalized"
            />
          </div>
          <div>
            <Label htmlFor="ps-notes">Notes</Label>
            <Input
              id="ps-notes"
              name="notes"
              maxLength={2000}
              placeholder="Boston-area peer station; never a sponsor."
              data-testid="peer-stations-input-notes"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={busy}
              data-testid="peer-stations-create-submit"
            >
              Add
            </Button>
          </div>
        </form>
      </section>

      {(['active', 'deprecated'] as const).map((status) => (
        <section key={status} data-testid={`peer-stations-section-${status}`}>
          <h2 className="text-base font-semibold capitalize">
            {status === 'active' ? 'Active peers' : 'Deprecated peers'} (
            {grouped[status].length})
          </h2>
          {grouped[status].length === 0 ? (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              No rows.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[hsl(var(--border))] rounded-md border">
              {grouped[status].map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <li
                    key={row.id}
                    data-testid={`peer-stations-row-${row.normalized_name}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  >
                    {isEditing ? (
                      <PeerRowEditor
                        row={row}
                        onSave={async (patch) => {
                          await handlePatch(row.id, patch);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                        disabled={busy}
                      />
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{row.display_name}</div>
                          <div className="text-xs text-[hsl(var(--muted-foreground))]">
                            <code>{row.normalized_name}</code>
                            {row.notes ? ` — ${row.notes}` : ''}
                          </div>
                        </div>
                        <select
                          aria-label="Status"
                          className={SELECT_CLASS}
                          value={row.status}
                          disabled={busy}
                          onChange={(e) =>
                            handlePatch(row.id, {
                              status: e.target.value as PeerStationStatus,
                            })
                          }
                          data-testid={`peer-stations-status-${row.normalized_name}`}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setEditingId(row.id)}
                          data-testid={`peer-stations-edit-${row.normalized_name}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleDelete(row)}
                          data-testid={`peer-stations-delete-${row.normalized_name}`}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function PeerRowEditor({
  row,
  onSave,
  onCancel,
  disabled,
}: {
  row: PeerStationRow;
  onSave: (patch: Partial<PeerStationRow>) => Promise<void>;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [display, setDisplay] = useState(row.display_name);
  const [normalized, setNormalized] = useState(row.normalized_name);
  const [notes, setNotes] = useState(row.notes ?? '');

  return (
    <div className="grid w-full gap-3 sm:grid-cols-[2fr_2fr_3fr_auto]">
      <Input
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        placeholder="Display name"
        maxLength={120}
        data-testid={`peer-stations-edit-display-${row.normalized_name}`}
      />
      <Input
        value={normalized}
        onChange={(e) =>
          setNormalized(deriveNormalizedName(e.target.value))
        }
        placeholder="normalized form"
        maxLength={120}
        pattern="[a-z0-9 ]+"
        data-testid={`peer-stations-edit-normalized-${row.normalized_name}`}
      />
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        maxLength={2000}
        data-testid={`peer-stations-edit-notes-${row.normalized_name}`}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onSave({
              display_name: display.trim(),
              normalized_name: normalized.trim(),
              notes: notes.trim() || null,
            })
          }
          data-testid={`peer-stations-save-${row.normalized_name}`}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { VocabAxis, VocabRow, VocabStatus } from '@/lib/queries/vocab';

const AXES: ReadonlyArray<VocabAxis> = [
  'sector',
  'operating_model',
  'genre',
  'affiliation',
  'cadence',
  'daypart_fit',
  'history',
  'compliance',
  'other',
];

const STATUSES: ReadonlyArray<VocabStatus> = [
  'active',
  'pending_admin_review',
  'deprecated',
];

export function VocabManager({ initialRows }: { initialRows: VocabRow[] }) {
  const [rows, setRows] = useState<VocabRow[]>(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const pending = useMemo(
    () => rows.filter((r) => r.status === 'pending_admin_review'),
    [rows],
  );
  const byAxis = useMemo(() => {
    const map = new Map<VocabAxis, VocabRow[]>();
    for (const a of AXES) map.set(a, []);
    for (const r of rows) {
      if (r.status !== 'pending_admin_review') {
        map.get(r.axis)?.push(r);
      }
    }
    return map;
  }, [rows]);

  function refresh(updated: VocabRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleCreate(formData: FormData) {
    const axis = formData.get('axis') as VocabAxis;
    const value = (formData.get('value') as string).trim();
    if (!value) {
      toast.error('Value is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/admin/vocab', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ axis, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const created = (await res.json()) as VocabRow;
      setRows((prev) => [...prev, created]);
      toast.success(`Created ${created.axis}:${created.value}`);
    });
  }

  async function handlePatch(id: string, body: Partial<VocabRow>) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await fetch(`/api/admin/vocab/${id}`, {
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
        const updated = (await res.json()) as VocabRow;
        refresh(updated);
        toast.success(`Updated ${updated.axis}:${updated.value}`);
        resolve();
      });
    });
  }

  async function handleDelete(row: VocabRow) {
    const ok = confirm(
      `Delete ${row.axis}:${row.value}? This removes the tag from every prospect that has it. This cannot be undone.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/vocab/${row.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `HTTP ${res.status}`);
        return;
      }
      remove(row.id);
      toast.success(`Deleted ${row.axis}:${row.value}`);
    });
  }

  async function handleMerge(source: VocabRow) {
    const sameAxis = rows.filter(
      (r) => r.axis === source.axis && r.id !== source.id,
    );
    if (sameAxis.length === 0) {
      toast.error('No same-axis target available.');
      return;
    }
    const targetValue = prompt(
      `Merge ${source.axis}:${source.value} into which target value?\n\n` +
        `Same-axis options: ${sameAxis.map((r) => r.value).join(', ')}`,
    );
    if (!targetValue) return;
    const target = sameAxis.find((r) => r.value === targetValue.trim());
    if (!target) {
      toast.error(`No same-axis tag named "${targetValue}".`);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/vocab/${source.id}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_id: target.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const result = await res.json();
      remove(source.id);
      toast.success(
        `Merged into ${target.axis}:${target.value} (${result.affected_prospect_count} prospects moved, ${result.collision_count} collisions)`,
      );
    });
  }

  return (
    <div className="space-y-6" data-testid="vocab-manager">
      {/* New tag form */}
      <form
        action={handleCreate}
        className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 sm:flex-row sm:items-end"
        data-testid="vocab-create-form"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Axis
          </span>
          <select
            name="axis"
            defaultValue="other"
            className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
            data-testid="vocab-create-axis"
          >
            {AXES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Value
          </span>
          <input
            name="value"
            placeholder="lower_snake_case"
            pattern="[a-z0-9_]+"
            className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
            data-testid="vocab-create-value"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          data-testid="vocab-create-submit"
        >
          Add tag
        </button>
      </form>

      {/* Pending admin review at top */}
      {pending.length > 0 && (
        <section
          className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-4"
          data-testid="vocab-pending-block"
        >
          <h2 className="mb-2 text-sm font-semibold">
            Pending admin review ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((row) => (
              <li
                key={row.id}
                data-testid="vocab-row"
                data-row-id={row.id}
                data-axis={row.axis}
                data-status={row.status}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span
                  aria-label="Pending review"
                  className="inline-block h-2 w-2 rounded-full bg-yellow-500"
                  data-testid="vocab-pending-dot"
                />
                <code className="font-mono">{row.axis}</code>
                <span className="text-[hsl(var(--muted-foreground))]">/</span>
                <code className="font-mono font-semibold">{row.value}</code>
                <button
                  type="button"
                  className="ml-auto rounded-md border px-2 py-1 text-xs"
                  onClick={() => handlePatch(row.id, { status: 'active' })}
                  data-testid="vocab-approve"
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs"
                  onClick={() =>
                    handlePatch(row.id, { status: 'deprecated' })
                  }
                  data-testid="vocab-reject"
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs text-red-600"
                  onClick={() => handleDelete(row)}
                  data-testid="vocab-delete"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-axis sections */}
      {AXES.map((axis) => {
        const axisRows = byAxis.get(axis) ?? [];
        return (
          <section
            key={axis}
            data-testid="vocab-axis-block"
            data-axis={axis}
          >
            <h2 className="mb-2 text-sm font-semibold capitalize">
              {axis} <span className="text-[hsl(var(--muted-foreground))]">({axisRows.length})</span>
            </h2>
            {axisRows.length === 0 ? (
              <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
                No values yet.
              </p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border-subtle))] rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
                {axisRows.map((row) => (
                  <li
                    key={row.id}
                    data-testid="vocab-row"
                    data-row-id={row.id}
                    data-axis={row.axis}
                    data-status={row.status}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                  >
                    {editingId === row.id ? (
                      <EditRowForm
                        row={row}
                        onCancel={() => setEditingId(null)}
                        onSave={async (patch) => {
                          await handlePatch(row.id, patch);
                          setEditingId(null);
                        }}
                      />
                    ) : (
                      <>
                        <code className="font-mono font-semibold">
                          {row.value}
                        </code>
                        <select
                          value={row.status}
                          onChange={(e) =>
                            handlePatch(row.id, {
                              status: e.target.value as VocabStatus,
                            })
                          }
                          className="ml-2 rounded border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-1 py-0.5 text-xs"
                          data-testid="vocab-status-select"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <div className="ml-auto flex gap-1">
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs"
                            onClick={() => setEditingId(row.id)}
                            data-testid="vocab-edit"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs"
                            onClick={() => handleMerge(row)}
                            data-testid="vocab-merge"
                          >
                            Merge…
                          </button>
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs text-red-600"
                            onClick={() => handleDelete(row)}
                            data-testid="vocab-delete"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EditRowForm({
  row,
  onCancel,
  onSave,
}: {
  row: VocabRow;
  onCancel: () => void;
  onSave: (patch: Partial<VocabRow>) => Promise<void>;
}) {
  const [value, setValue] = useState(row.value);
  const [axis, setAxis] = useState<VocabAxis>(row.axis);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        pattern="[a-z0-9_]+"
        className="rounded border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
        data-testid="vocab-edit-value"
      />
      <select
        value={axis}
        onChange={(e) => setAxis(e.target.value as VocabAxis)}
        className="rounded border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
        data-testid="vocab-edit-axis"
      >
        {AXES.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded bg-[hsl(var(--primary))] px-2 py-1 text-xs text-[hsl(var(--primary-foreground))]"
        onClick={() => {
          const patch: Partial<VocabRow> = {};
          if (value.trim() !== row.value) patch.value = value.trim();
          if (axis !== row.axis) patch.axis = axis;
          if (Object.keys(patch).length === 0) {
            onCancel();
            return;
          }
          void onSave(patch);
        }}
        data-testid="vocab-edit-save"
      >
        Save
      </button>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={onCancel}
        data-testid="vocab-edit-cancel"
      >
        Cancel
      </button>
    </div>
  );
}

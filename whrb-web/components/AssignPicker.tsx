'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type AssignProfile = {
  id: string;
  display_name: string | null;
  email: string;
};

export type AssignPickerProps = {
  prospectId: string;
  currentAssignee: AssignProfile | null;
  currentUserId: string;
  profiles: AssignProfile[];
};

function labelFor(p: AssignProfile): string {
  return p.display_name || p.email.split('@')[0];
}

export function AssignPicker({
  prospectId,
  currentAssignee,
  currentUserId,
  profiles,
}: AssignPickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<AssignProfile | null>(currentAssignee);
  useEffect(() => setLocal(currentAssignee), [currentAssignee]);

  async function patch(targetId: string | null) {
    setError(null);
    const nextAssignee =
      targetId === null ? null : profiles.find((p) => p.id === targetId) ?? null;
    setLocal(nextAssignee);
    const res = await fetch(`/api/prospects/${prospectId}/assign`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assigned_to: targetId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Assignment failed.');
      setLocal(currentAssignee);
      return;
    }
    setOpen(false);
    startTransition(() => router.refresh());
  }

  const canPickUp = !local || local.id !== currentUserId;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="assign-picker">
      <span className="text-sm text-[hsl(var(--muted-foreground))]">Assigned to:</span>
      <span
        data-testid="assign-current"
        className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] px-2 py-1 text-sm font-medium"
      >
        {local ? labelFor(local) : 'Unassigned'}
      </span>
      {canPickUp ? (
        <button
          type="button"
          onClick={() => patch(currentUserId)}
          disabled={pending}
          data-testid="assign-pickup"
          className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
        >
          Pick up
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        data-testid="assign-toggle"
        className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
      >
        Reassign
      </button>
      {local ? (
        <button
          type="button"
          onClick={() => patch(null)}
          disabled={pending}
          data-testid="assign-clear"
          className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
        >
          Clear
        </button>
      ) : null}
      {open ? (
        <select
          data-testid="assign-select"
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
          defaultValue={local?.id ?? ''}
          onChange={(e) => patch(e.target.value || null)}
        >
          <option value="">— Select team member —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {labelFor(p)}
              {p.id === currentUserId ? ' (me)' : ''}
            </option>
          ))}
        </select>
      ) : null}
      {error ? (
        <span data-testid="assign-error" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </span>
      ) : null}
    </div>
  );
}

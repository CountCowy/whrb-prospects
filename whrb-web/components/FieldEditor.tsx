'use client';

import { useEffect, useState, useTransition } from 'react';

export type FieldEditorProps = {
  prospectId: string;
  field: string;
  label: string;
  value: string | number | boolean | null | undefined;
  inputType?: 'text' | 'email' | 'url' | 'tel' | 'number';
  editable: boolean;
  locked: boolean;
  showLockIcon?: boolean;
  onSaved?: () => void;
};

export function FieldEditor({
  prospectId,
  field,
  label,
  value,
  inputType = 'text',
  editable,
  locked,
  showLockIcon = true,
  onSaved,
}: FieldEditorProps) {
  const [editing, setEditing] = useState(false);
  const [displayed, setDisplayed] = useState(value);
  const [lockedLocal, setLockedLocal] = useState(locked);
  useEffect(() => setDisplayed(value), [value]);
  useEffect(() => setLockedLocal(locked), [locked]);
  const [draft, setDraft] = useState<string>(value === null || value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function save() {
    setError(null);
    const payloadValue: unknown =
      inputType === 'number' ? (draft === '' ? null : Number(draft)) : draft === '' ? null : draft;
    const res = await fetch(`/api/prospects/${prospectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { [field]: payloadValue } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Save failed');
      return;
    }
    setEditing(false);
    setDisplayed(payloadValue as typeof displayed);
    setLockedLocal(true);
    startTransition(() => {
      onSaved?.();
    });
  }

  async function unlock() {
    setError(null);
    const res = await fetch(`/api/prospects/${prospectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unlock: field }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Unlock failed');
      return;
    }
    setLockedLocal(false);
    startTransition(() => {
      onSaved?.();
    });
  }

  const displayValue =
    displayed === null || displayed === undefined || displayed === ''
      ? '—'
      : typeof displayed === 'boolean'
        ? displayed
          ? 'Yes'
          : 'No'
        : String(displayed);

  return (
    <div
      data-testid={`field-editor-${field}`}
      className="grid grid-cols-3 items-start gap-3 py-2"
    >
      <dt className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        <span className="inline-flex items-center gap-1">
          {label}
          {showLockIcon && lockedLocal ? (
            <span
              aria-label="locked"
              data-testid={`lock-${field}`}
              title="Locked by user edit — pipeline re-runs won't overwrite."
              className="inline-flex h-4 w-4 items-center justify-center rounded border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[10px] text-[hsl(var(--primary))]"
            >
              🔒
            </span>
          ) : null}
        </span>
      </dt>
      <dd className="col-span-2 space-y-1 text-sm text-[hsl(var(--foreground))]">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            {inputType === 'number' ? (
              <input
                type="number"
                className="min-w-[180px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                data-testid={`field-input-${field}`}
              />
            ) : (
              <input
                type={inputType}
                className="min-w-[240px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                data-testid={`field-input-${field}`}
              />
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              data-testid={`field-save-${field}`}
              className="rounded-md border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(displayed === null || displayed === undefined ? '' : String(displayed));
                setError(null);
              }}
              className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid={`field-value-${field}`}
              className={displayed === null || displayed === undefined || displayed === '' ? 'text-[hsl(var(--muted-foreground))]' : ''}
            >
              {displayValue}
            </span>
            {editable ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                data-testid={`field-edit-${field}`}
                className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
              >
                Edit
              </button>
            ) : null}
            {editable && lockedLocal && showLockIcon ? (
              <button
                type="button"
                onClick={unlock}
                data-testid={`field-unlock-${field}`}
                className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-4 hover:text-[hsl(var(--foreground))]"
              >
                Unlock
              </button>
            ) : null}
          </div>
        )}
        {error ? (
          <p data-testid={`field-error-${field}`} className="text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

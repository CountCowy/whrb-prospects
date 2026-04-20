'use client';

import { useEffect, useRef, useState } from 'react';

export const COLUMN_VISIBILITY_KEY = 'prospectTable.visibleColumns.v1';

export type ColumnDef = { key: string; label: string; defaultVisible?: boolean };

type Props = {
  columns: ColumnDef[];
  onChange: (visible: Set<string>) => void;
};

export function ColumnVisibilityMenu({ columns, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(
    new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key)),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLUMN_VISIBILITY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const next = new Set(parsed);
        setVisible(next);
        onChange(next);
        return;
      }
    } catch {
      // ignore parse failures; fall through to defaults
    }
    onChange(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function toggle(key: string) {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisible(next);
    try {
      window.localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify([...next]));
    } catch {
      // ignore quota / private-mode errors
    }
    onChange(next);
  }

  function reset() {
    const next = new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key));
    setVisible(next);
    try {
      window.localStorage.removeItem(COLUMN_VISIBILITY_KEY);
    } catch {
      // ignore
    }
    onChange(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid="column-toggle"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Columns ({visible.size}/{columns.length})
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 max-h-96 w-64 overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 shadow-[var(--shadow-md)]"
        >
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              Show columns
            </span>
            <button
              type="button"
              onClick={reset}
              data-testid="column-reset"
              className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--primary))] hover:underline"
            >
              Reset
            </button>
          </div>
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[hsl(var(--muted))]"
            >
              <input
                type="checkbox"
                checked={visible.has(c.key)}
                onChange={() => toggle(c.key)}
                data-testid={`column-toggle-${c.key}`}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

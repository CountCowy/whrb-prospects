'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const COLUMN_VISIBILITY_KEY = 'prospectTable.visibleColumns.v1';

export type ColumnDef = { key: string; label: string; defaultVisible?: boolean };

type Props = {
  columns: ColumnDef[];
  onChange: (visible: Set<string>) => void;
};

export function ColumnVisibilityMenu({ columns, onChange }: Props) {
  const [visible, setVisible] = useState<Set<string>>(
    new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key)),
  );

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
    const next = new Set(
      columns.filter((c) => c.defaultVisible !== false).map((c) => c.key),
    );
    setVisible(next);
    try {
      window.localStorage.removeItem(COLUMN_VISIBILITY_KEY);
    } catch {
      // ignore
    }
    onChange(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="column-toggle"
          className="text-xs font-medium"
        >
          Columns ({visible.size}/{columns.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 w-64 overflow-auto"
      >
        <div className="flex items-center justify-between px-2">
          <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Show columns
          </DropdownMenuLabel>
          <button
            type="button"
            onClick={reset}
            data-testid="column-reset"
            className="text-[10px] font-medium uppercase tracking-widest text-primary hover:underline"
          >
            Reset
          </button>
        </div>
        <DropdownMenuSeparator />
        <div className="p-1">
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={visible.has(c.key)}
                onCheckedChange={() => toggle(c.key)}
                data-testid={`column-toggle-${c.key}`}
              />
              {c.label}
            </label>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

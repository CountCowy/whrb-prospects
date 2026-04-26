'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// v2 (010): bumped so users with v1 prefs that excluded `contact_email`
// (it used to be defaultVisible: false) get the new default-visible
// multi-email column on first post-deploy load. They can re-customize
// from there. Old v1 data is left in localStorage and never read again.
export const COLUMN_VISIBILITY_KEY = 'prospectTable.visibleColumns.v2';

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
          <DropdownMenuItem
            onSelect={(e) => {
              // Don't close the menu — reset is a modifier, not a navigation.
              e.preventDefault();
              reset();
            }}
            data-testid="column-reset"
            className="cursor-pointer px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-primary hover:!bg-transparent hover:underline focus:!bg-transparent"
          >
            Reset
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={visible.has(c.key)}
            onCheckedChange={() => toggle(c.key)}
            onSelect={(e) => {
              // Keep the menu open so the user can toggle multiple columns
              // in one session. Radix's default behaviour is to close on
              // select — we override with preventDefault.
              e.preventDefault();
            }}
            data-testid={`column-toggle-${c.key}`}
            className="cursor-pointer"
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

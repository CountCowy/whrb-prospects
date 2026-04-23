'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type FilterOption = { value: string; label: string };

export type FilterFacet = {
  key: 'tier' | 'state' | 'source' | 'assigned' | 'is_nonprofit' | 'zip' | 'category';
  label: string;
  type: 'select' | 'text';
  options?: FilterOption[];
};

const ASSIGNED: FilterOption[] = [
  { value: 'true', label: 'Assigned' },
  { value: 'false', label: 'Unassigned' },
];
const NONPROFIT: FilterOption[] = [
  { value: 'true', label: 'Nonprofit' },
  { value: 'false', label: 'For-profit / unknown' },
];

// Native <select> styled to match shadcn Input height + border.
// Kept native (not Radix Select) on purpose: native pickers give the
// mobile platform-appropriate UX for free.
const SELECT_CLASS =
  'flex h-9 min-w-32 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function FilterBar({
  tiers,
  states,
  sources,
  showAssignedFacet = true,
}: {
  tiers: string[];
  states: string[];
  sources: string[];
  showAssignedFacet?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const facets: FilterFacet[] = [
    { key: 'tier', label: 'Tier', type: 'select', options: tiers.map((t) => ({ value: t, label: `Tier ${t}` })) },
    {
      key: 'state',
      label: 'State',
      type: 'select',
      options: states.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
    },
    { key: 'source', label: 'Source', type: 'select', options: sources.map((s) => ({ value: s, label: s })) },
    { key: 'is_nonprofit', label: 'Nonprofit', type: 'select', options: NONPROFIT },
    { key: 'zip', label: 'ZIP', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
  ];
  if (showAssignedFacet) {
    facets.splice(3, 0, { key: 'assigned', label: 'Assignment', type: 'select', options: ASSIGNED });
  }

  function clearAll() {
    const next = new URLSearchParams(params.toString());
    for (const f of facets) next.delete(f.key);
    next.delete('q');
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const activeCount = facets.filter((f) => params.get(f.key)).length;

  return (
    <div data-testid="filter-bar" className="flex flex-wrap items-end gap-2">
      {facets.map((f) => {
        const value = params.get(f.key) ?? '';
        const labelClass =
          'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
        if (f.type === 'select') {
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={`filter-${f.key}`} className={labelClass}>
                {f.label}
              </Label>
              <select
                id={`filter-${f.key}`}
                data-testid={`filter-${f.key}`}
                value={value}
                onChange={(e) => set(f.key, e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Any</option>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`filter-${f.key}`} className={labelClass}>
              {f.label}
            </Label>
            <Input
              id={`filter-${f.key}`}
              type="text"
              data-testid={`filter-${f.key}`}
              defaultValue={value}
              placeholder={f.key === 'zip' ? '02138' : ''}
              onBlur={(e) => set(f.key, e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') set(f.key, (e.target as HTMLInputElement).value.trim());
              }}
              className={cn('w-24 text-sm font-normal normal-case tracking-normal')}
            />
          </div>
        );
      })}
      {activeCount > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearAll}
          data-testid="clear-filters"
          className="self-end text-xs"
        >
          Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  );
}

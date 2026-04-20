'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

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
    <div
      data-testid="filter-bar"
      className="flex flex-wrap items-end gap-2"
    >
      {facets.map((f) => {
        const value = params.get(f.key) ?? '';
        if (f.type === 'select') {
          return (
            <label key={f.key} className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {f.label}
              <select
                data-testid={`filter-${f.key}`}
                value={value}
                onChange={(e) => set(f.key, e.target.value)}
                className="min-w-32 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]"
              >
                <option value="">Any</option>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={f.key} className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {f.label}
            <input
              type="text"
              data-testid={`filter-${f.key}`}
              defaultValue={value}
              placeholder={f.key === 'zip' ? '02138' : ''}
              onBlur={(e) => set(f.key, e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') set(f.key, (e.target as HTMLInputElement).value.trim());
              }}
              className="w-24 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]"
            />
          </label>
        );
      })}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          data-testid="clear-filters"
          className="self-end rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

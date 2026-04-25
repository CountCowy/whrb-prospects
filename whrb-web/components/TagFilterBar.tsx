'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  TAG_PRESETS,
  TAG_PARAM_PREFIX,
  DAYPART_PARAM,
  buildPresetUrl,
  clearPresetFromParams,
  readTagFilterFromParams,
  writeTagFilterToParams,
} from '@/lib/tag-filters';
import { AXES, type Axis } from '@/styles/tag-colors';
import type { VocabRow } from '@/lib/queries/vocab';

export type TagFilterBarProps = {
  vocab: VocabRow[];
  /** Daypart values from `prospect_daypart.daypart_fit` (T2). */
  daypartValues: string[];
};

/**
 * Composite filter widget. Stack:
 *   1. Preset chip row (always visible, scrolls horizontally on mobile)
 *   2. Mobile-only flat tag-search (visible <md)
 *   3. Advanced Filters toggle (md+ only) with multi-select per axis
 *
 * URL state is the source of truth. Click handlers compute the next
 * URLSearchParams and `router.push()` the new path.
 */
export function TagFilterBar({ vocab, daypartValues }: TagFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activePresetId = searchParams.get('preset');
  const filterState = useMemo(
    () => readTagFilterFromParams(searchParams),
    [searchParams],
  );
  const totalActive = useMemo(() => {
    let n = 0;
    for (const axis of AXES) {
      n += (filterState.byAxis[axis] ?? []).length;
    }
    n += filterState.daypart.length;
    return n;
  }, [filterState]);

  const vocabByAxis = useMemo(() => {
    const map = new Map<Axis, VocabRow[]>();
    for (const a of AXES) map.set(a, []);
    for (const r of vocab) {
      if (r.status !== 'active') continue;
      const list = map.get(r.axis as Axis);
      if (list) list.push(r);
    }
    for (const [k, v] of map) {
      v.sort((a, b) => a.value.localeCompare(b.value));
      map.set(k, v);
    }
    return map;
  }, [vocab]);

  const [search, setSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function applyPreset(id: string) {
    const preset = TAG_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next =
      activePresetId === id
        ? clearPresetFromParams(searchParams)
        : buildPresetUrl(preset, searchParams);
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleAxisValue(axis: Axis, value: string) {
    const cur = new Set(filterState.byAxis[axis] ?? []);
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    const nextState = {
      ...filterState,
      byAxis: { ...filterState.byAxis, [axis]: [...cur] },
    };
    if (cur.size === 0) delete nextState.byAxis[axis];
    const next = writeTagFilterToParams(nextState, searchParams);
    next.delete('page');
    next.delete('preset');
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleDaypart(value: string) {
    const cur = new Set(filterState.daypart);
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    const nextState = { ...filterState, daypart: [...cur] };
    const next = writeTagFilterToParams(nextState, searchParams);
    next.delete('page');
    next.delete('preset');
    router.push(`${pathname}?${next.toString()}`);
  }

  function clearAllTagFilters() {
    const next = new URLSearchParams(searchParams.toString());
    for (const axis of AXES) next.delete(TAG_PARAM_PREFIX + axis);
    next.delete(DAYPART_PARAM);
    next.delete('preset');
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  // Mobile flat-search results. Filters across every active vocab value.
  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [] as Array<{ axis: Axis; value: string }>;
    const out: Array<{ axis: Axis; value: string }> = [];
    for (const axis of AXES) {
      for (const row of vocabByAxis.get(axis) ?? []) {
        if (row.value.toLowerCase().startsWith(term)) {
          out.push({ axis: row.axis as Axis, value: row.value });
        }
      }
    }
    return out.slice(0, 12);
  }, [search, vocabByAxis]);

  return (
    <div data-testid="tag-filter-bar" className="space-y-3">
      {/* Preset row */}
      <div
        data-testid="tag-presets"
        className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible"
      >
        {TAG_PRESETS.map((p) => {
          const active = activePresetId === p.id;
          return (
            <Button
              key={p.id}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              data-testid={`tag-preset-${p.id}`}
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              onClick={() => applyPreset(p.id)}
              title={p.hint}
              className="h-8 shrink-0 whitespace-nowrap text-xs"
            >
              {p.label}
            </Button>
          );
        })}
        {totalActive > 0 && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="tag-filters-clear"
              onClick={clearAllTagFilters}
              className="h-8 text-xs"
            >
              Clear {totalActive} tag{totalActive === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </div>

      {/* Mobile-only flat search */}
      <div className="md:hidden">
        <Label htmlFor="tag-flat-search" className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Search tags
        </Label>
        <Input
          id="tag-flat-search"
          data-testid="tag-flat-search"
          type="search"
          placeholder="e.g. classical, harvard"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1"
        />
        {searchResults.length > 0 && (
          <ul
            data-testid="tag-flat-search-results"
            className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-2 text-xs"
          >
            {searchResults.map((r) => {
              const isActive =
                (filterState.byAxis[r.axis] ?? []).includes(r.value);
              return (
                <li key={`${r.axis}:${r.value}`}>
                  <Button
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    data-testid={`tag-flat-search-result-${r.axis}-${r.value}`}
                    data-active={isActive ? 'true' : 'false'}
                    onClick={() => toggleAxisValue(r.axis, r.value)}
                    className="h-7 text-[11px]"
                  >
                    {r.axis}:{r.value}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Advanced Filters (desktop) */}
      <details
        className="hidden md:block"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        data-testid="tag-advanced-filters"
      >
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Advanced filters
        </summary>
        <div className="mt-3 grid gap-4 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 sm:grid-cols-2 lg:grid-cols-3">
          {AXES.map((axis) => {
            const rows = vocabByAxis.get(axis) ?? [];
            const selected = new Set(filterState.byAxis[axis] ?? []);
            return (
              <fieldset
                key={axis}
                data-testid={`tag-advanced-axis-${axis}`}
                className="space-y-1"
              >
                <legend className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground capitalize">
                  {axis.replace(/_/g, ' ')}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {rows.length === 0 ? (
                    <span className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                      No values yet.
                    </span>
                  ) : (
                    rows.map((r) => {
                      const checked = selected.has(r.value);
                      return (
                        <label
                          key={r.id}
                          data-testid={`tag-advanced-option-${axis}-${r.value}`}
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2 py-1 text-[11px]',
                            checked && 'border-[hsl(var(--primary))]',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleAxisValue(axis, r.value)}
                          />
                          {r.value}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>
            );
          })}

          {daypartValues.length > 0 && (
            <fieldset data-testid="tag-advanced-daypart" className="space-y-1">
              <legend className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Daypart fit
              </legend>
              <div className="flex flex-wrap gap-2">
                {daypartValues.map((v) => {
                  const checked = filterState.daypart.includes(v);
                  return (
                    <label
                      key={v}
                      data-testid={`tag-advanced-daypart-${v}`}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2 py-1 text-[11px]',
                        checked && 'border-[hsl(var(--primary))]',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDaypart(v)}
                      />
                      {v}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </details>
    </div>
  );
}

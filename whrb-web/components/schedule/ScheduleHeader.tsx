'use client';

import { addDays, addMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatInTz } from '@/lib/time';
import {
  CATEGORY_LABELS,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
} from '@/styles/schedule-colors';

export type ScheduleHeaderProps = {
  view: 'month' | 'agenda';
  anchor: Date;
  scope: 'mine' | 'team' | 'all';
  categories: ScheduleCategory[];
  onChangeView: (v: 'month' | 'agenda') => void;
  onChangeAnchor: (d: Date) => void;
  onChangeScope: (s: 'mine' | 'team' | 'all') => void;
  onChangeCategories: (c: ScheduleCategory[]) => void;
  onCreateClick: () => void;
};

export function ScheduleHeader({
  view,
  anchor,
  scope,
  categories,
  onChangeView,
  onChangeAnchor,
  onChangeScope,
  onChangeCategories,
  onCreateClick,
}: ScheduleHeaderProps) {
  function shift(direction: 1 | -1) {
    if (view === 'month') {
      onChangeAnchor(addMonths(anchor, direction));
    } else {
      onChangeAnchor(addDays(anchor, direction * 7));
    }
  }

  function toggleCategory(c: ScheduleCategory) {
    if (categories.includes(c)) {
      onChangeCategories(categories.filter((x) => x !== c));
    } else {
      onChangeCategories([...categories, c]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            data-testid="schedule-prev"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="schedule-today"
            onClick={() => onChangeAnchor(new Date())}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            data-testid="schedule-next"
            onClick={() => shift(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span
            className="ml-2 text-base font-semibold"
            data-testid="schedule-anchor-label"
          >
            {formatInTz(anchor, view === 'month' ? 'MMMM yyyy' : 'MMMM d, yyyy')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" className="inline-flex rounded-md border">
            {(['month', 'agenda'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                data-testid={`schedule-view-${v}`}
                aria-selected={view === v}
                onClick={() => onChangeView(v)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  view === v
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <select
            value={scope}
            onChange={(e) =>
              onChangeScope(e.target.value as 'mine' | 'team' | 'all')
            }
            className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
            data-testid="schedule-scope"
            aria-label="Scope"
          >
            <option value="all">All visible</option>
            <option value="mine">Mine</option>
            <option value="team">Team (no private)</option>
          </select>
          <Button
            type="button"
            size="sm"
            data-testid="schedule-create-button"
            onClick={onCreateClick}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New event
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="schedule-category-filter">
        {SCHEDULE_CATEGORIES.map((c) => {
          const active = categories.includes(c);
          return (
            <button
              key={c}
              type="button"
              data-testid={`schedule-category-chip-${c}`}
              aria-pressed={active}
              onClick={() => toggleCategory(c)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] border-[hsl(var(--primary))]'
                  : 'border-[hsl(var(--border-subtle))] text-[hsl(var(--muted-foreground))] hover:bg-muted'
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

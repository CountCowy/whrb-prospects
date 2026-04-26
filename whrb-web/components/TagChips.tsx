'use client';

import { useMemo } from 'react';

import { TagChip } from '@/components/TagChip';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { overflowClass, type Axis } from '@/styles/tag-colors';
import type { ProspectTagView } from '@/lib/queries/prospect-tags';

export type TagChipsMode = 'compact' | 'full';

export type TagChipsProps = {
  prospectId: string;
  tags: ProspectTagView[];
  mode: TagChipsMode;
  currentUserId: string;
  isAdmin: boolean;
  /**
   * In `compact` mode, chips are always read-only and the user clicks
   * through to the detail page for editing. In `full` mode, set
   * `interactive=true` to expose lock toggle + clear X.
   */
  interactive?: boolean;
  onChanged?: () => void;
  onUndoDelete?: (snapshot: {
    tagRowId: string;
    tagId: string;
    prospectId: string;
    lockedBy: string | null;
  }) => Promise<void> | void;
};

const COMPACT_LIMIT = 4;

export function TagChips({
  prospectId,
  tags,
  mode,
  currentUserId,
  isAdmin,
  interactive = false,
  onChanged,
  onUndoDelete,
}: TagChipsProps) {
  const grouped = useMemo(() => groupByAxis(tags), [tags]);

  if (tags.length === 0) {
    if (mode === 'full') {
      return (
        <p
          data-testid="tag-chips-empty"
          className="text-[11px] text-[hsl(var(--muted-foreground))]"
        >
          No tags yet.
        </p>
      );
    }
    return (
      <span
        data-testid="tag-chips-empty"
        className="text-[10px] text-[hsl(var(--muted-foreground))]"
      >
        —
      </span>
    );
  }

  if (mode === 'compact') {
    const visible = tags.slice(0, COMPACT_LIMIT);
    const overflow = tags.slice(COMPACT_LIMIT);
    return (
      <div
        data-testid="tag-chips-compact"
        className="flex flex-wrap items-center gap-1"
      >
        {visible.map((t) => (
          <TagChip
            key={t.id}
            tagRowId={t.id}
            tagId={t.tag_id}
            prospectId={prospectId}
            axis={t.axis}
            value={t.value}
            status={t.status}
            lockedBy={t.locked_by}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            interactive={false}
          />
        ))}
        {overflow.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="tag-chips-overflow"
                aria-label={`${overflow.length} more tags`}
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  overflowClass(),
                )}
              >
                +{overflow.length} more
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <ul
                data-testid="tag-chips-overflow-list"
                className="max-h-60 overflow-y-auto text-xs"
              >
                {overflow.map((t) => (
                  <li
                    key={t.id}
                    data-testid="tag-chips-overflow-item"
                    className="whitespace-nowrap"
                  >
                    {t.axis}:{t.value}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  // full mode: grouped by axis, all visible
  return (
    <div data-testid="tag-chips-full" className="space-y-2">
      {grouped.map(([axis, axisTags]) => (
        <div
          key={axis}
          data-testid="tag-chips-axis-group"
          data-axis={axis}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {axis.replace(/_/g, ' ')}
          </span>
          {axisTags.map((t) => (
            <TagChip
              key={t.id}
              tagRowId={t.id}
              tagId={t.tag_id}
              prospectId={prospectId}
              axis={t.axis}
              value={t.value}
              status={t.status}
              lockedBy={t.locked_by}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              interactive={interactive}
              onChanged={onChanged}
              onUndoDelete={onUndoDelete}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function groupByAxis(
  tags: ProspectTagView[],
): Array<[Axis, ProspectTagView[]]> {
  const map = new Map<Axis, ProspectTagView[]>();
  for (const t of tags) {
    const list = map.get(t.axis) ?? [];
    list.push(t);
    map.set(t.axis, list);
  }
  return Array.from(map.entries());
}

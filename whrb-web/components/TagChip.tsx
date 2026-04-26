'use client';

import { Lock, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { chipClass, type Axis } from '@/styles/tag-colors';

export type TagChipProps = {
  /** prospect_tags.id — used for DELETE / PATCH calls. */
  tagRowId: string;
  /** prospects.id — needed for the API URL. */
  prospectId: string;
  axis: Axis;
  value: string;
  /** vocab status for the pending-review yellow dot. */
  status: 'active' | 'pending_admin_review' | 'deprecated';
  /** Set when the tag is locked. */
  lockedBy: string | null;
  /** auth.uid() of the active user. */
  currentUserId: string;
  /** True for admins. */
  isAdmin: boolean;
  /**
   * When true the chip exposes lock toggle + clear X. When false
   * (table compact mode) the chip is read-only.
   */
  interactive: boolean;
  /** Called after a successful mutation so the parent can re-fetch. */
  onChanged?: () => void;
  /**
   * Called when the user requests undo via the toast. The component
   * surfaces a 30s sonner toast; the parent decides what "undo" means
   * (re-insert the row in our case) via the `onUndoDelete` callback.
   */
  onUndoDelete?: (snapshot: {
    tagRowId: string;
    tagId: string;
    prospectId: string;
    lockedBy: string | null;
  }) => Promise<void> | void;
  /** tag_vocabulary.id — needed by undo to re-INSERT the row. */
  tagId: string;
};

export function TagChip({
  tagRowId,
  tagId,
  prospectId,
  axis,
  value,
  status,
  lockedBy,
  currentUserId,
  isAdmin,
  interactive,
  onChanged,
  onUndoDelete,
}: TagChipProps) {
  const [busy, setBusy] = useState(false);

  const isLocked = lockedBy !== null;
  // Lock-aware capabilities — mirrored on the server by RLS + the API
  // route's owner check, but the disabled state here is a UX hint.
  const canClear = isAdmin || !isLocked || lockedBy === currentUserId;
  const canToggleLock = isAdmin || !isLocked || lockedBy === currentUserId;
  const isCompliance = axis === 'compliance';

  async function handleClear() {
    if (!interactive || !canClear || busy) return;
    if (isCompliance) {
      const ok = confirm(
        'Clearing this compliance flag will alert an admin. The tag will be soft-cleared (recoverable). Continue?',
      );
      if (!ok) return;
    }
    setBusy(true);
    const res = await fetch(
      `/api/prospects/${prospectId}/tags?tag_row_id=${tagRowId}`,
      { method: 'DELETE' },
    );
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `HTTP ${res.status}`);
      return;
    }
    const undoSnapshot = { tagRowId, tagId, prospectId, lockedBy };
    toast(`Removed ${axis}:${value}`, {
      duration: 30_000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (onUndoDelete) void onUndoDelete(undoSnapshot);
        },
      },
    });
    if (onChanged) onChanged();
  }

  async function handleToggleLock() {
    if (!interactive || !canToggleLock || busy) return;
    setBusy(true);
    const next = isLocked ? null : currentUserId;
    const res = await fetch(
      `/api/prospects/${prospectId}/tags?tag_row_id=${tagRowId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locked_by: next }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `HTTP ${res.status}`);
      return;
    }
    if (onChanged) onChanged();
  }

  const tooltipText = `${axis}:${value}${
    status === 'pending_admin_review' ? ' · pending admin review' : ''
  }${isLocked ? ' · locked' : ''}`;

  // Plain inline-button styling for the clear / lock controls — using
  // shadcn `<Button variant="ghost" size="sm">` here fights the cva on
  // every front: the cva injects px-3 (overriding p-0 longhand),
  // [&_svg]:size-4 (forcing icons to 16x16 inside our 16x16 pill), and
  // hover:bg-muted hover:text-foreground (inverting the chip's painted
  // text-white / text-zinc-900). A bespoke <button> keeps the chip
  // pixel-tight and honours the chipClass() palette.
  // Use ring-current rather than ring-white so the focus ring inherits
  // the chip foreground (white on most axes, zinc-900 on cadence). A
  // hard-coded white ring would wash out on amber-500 (cadence). 50%
  // opacity tones it down without losing legibility.
  const innerControlClass = cn(
    'inline-flex h-4 w-4 items-center justify-center rounded-full',
    'hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/50',
    'disabled:cursor-not-allowed disabled:opacity-30',
  );

  return (
    <span
      data-testid="tag-chip"
      data-axis={axis}
      data-value={value}
      data-locked={isLocked ? 'true' : 'false'}
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
        chipClass(axis),
      )}
    >
      {/* Tooltip wraps only the visual chip body — the clear / lock
       * controls sit as siblings outside the trigger so they don't trip
       * the axe nested-interactive rule. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1"
            aria-label={`Tag ${axis}:${value}`}
          >
            {status === 'pending_admin_review' && (
              <span
                data-testid="tag-pending-dot"
                aria-label="Pending admin review"
                className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-300 ring-1 ring-yellow-700/40"
              />
            )}
            {isLocked && (
              <Lock
                data-testid="tag-lock-icon"
                aria-label="Locked"
                className="h-3 w-3"
              />
            )}
            <span className="truncate">{value}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
      {interactive && (
        <button
          type="button"
          data-testid="tag-clear-btn"
          aria-label={`Clear ${axis}:${value}`}
          disabled={!canClear || busy}
          onClick={handleClear}
          className={cn('ml-0.5', innerControlClass)}
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {interactive && (
        <button
          type="button"
          data-testid="tag-lock-toggle"
          aria-label={isLocked ? `Unlock ${axis}:${value}` : `Lock ${axis}:${value}`}
          disabled={!canToggleLock || busy}
          onClick={handleToggleLock}
          className={innerControlClass}
        >
          <Lock className={cn('h-2.5 w-2.5', isLocked ? 'fill-current' : '')} />
        </button>
      )}
    </span>
  );
}
